import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const stat = jest.fn();
const readFile = jest.fn();
const parse = jest.fn();
const channelRead = jest.fn();
const channelPromote = jest.fn();
const channelResolve = jest.fn();
const snapshotWrite = jest.fn();
const channelConstructor = jest.fn();

jest.mock('fs/promises', () => ({ stat, readFile }));
jest.mock('../../src/schemas/experiment-result.schema.js', () => ({
  experimentResultSchema: { parse },
}));
jest.mock('../../src/baselines/index.js', () => ({
  BaselineSnapshotStore: jest.fn().mockImplementation(() => ({
    write: snapshotWrite,
  })),
  BaselineChannelStore: jest.fn().mockImplementation((_root, options) => {
    channelConstructor(options);
    return {
      read: channelRead,
      promote: channelPromote,
      resolve: channelResolve,
    };
  }),
}));

import {
  baselinePromoteCommand,
  baselineShowCommand,
  registerBaselineCommand,
} from '../../src/cli/commands/baseline.js';

function experiment(scope: 'variant' | 'testcase_variant' = 'variant') {
  return {
    experiment_id: 'experiment-1',
    aggregates: [{ variant_name: 'candidate', scope }],
  };
}

describe('baseline command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    stat.mockRejectedValue(new Error('not explicit'));
    readFile.mockResolvedValue('{}');
    parse.mockReturnValue(experiment());
    channelRead.mockResolvedValue(undefined);
    snapshotWrite.mockResolvedValue({ digest: 'digest-1' });
    channelPromote.mockResolvedValue({
      channel: { snapshot_digest: 'digest-1', generation: 1 },
    });
    channelResolve.mockResolvedValue({
      snapshot: {
        digest: 'digest-1',
        result: { experiment_id: 'experiment-1' },
      },
      channel: {
        name: 'production',
        default_target: 'candidate',
        generation: 1,
        updated_at: 'today',
      },
    });
  });

  it('promotes IDs with all audit options and prior channel mappings', async () => {
    channelRead.mockResolvedValue({
      channel: { default_target: 'old-target' },
    });
    const output: string[] = [];
    const now = () => new Date('2026-01-01T00:00:00Z');
    await baselinePromoteCommand(
      'experiment-1',
      {
        channel: 'production',
        target: 'candidate',
        expect: 'old-digest',
        actor: 'tester',
        context: 'release',
      },
      {
        cwd: 'project',
        stdout: (message) => output.push(message),
        now,
      }
    );
    expect(channelConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ now })
    );
    expect(channelPromote).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDigest: 'old-digest',
        actor: 'tester',
        context: 'release',
        targetMapping: {
          candidateTarget: 'candidate',
          baselineTarget: 'old-target',
        },
      })
    );
    expect(output[0]).toContain('Promoted candidate');
  });

  it('resolves explicit result files and directories and accepts testcase aggregates', async () => {
    stat.mockResolvedValueOnce({ isDirectory: () => false });
    parse.mockReturnValueOnce(experiment('testcase_variant'));
    await baselinePromoteCommand(
      'result.json',
      { channel: 'production', target: 'candidate' },
      { cwd: 'project', stdout: jest.fn() }
    );

    stat.mockResolvedValueOnce({ isDirectory: () => true });
    parse.mockReturnValueOnce(experiment());
    await baselinePromoteCommand(
      'result-directory',
      { channel: 'production', target: 'candidate' },
      { cwd: 'project', stdout: jest.fn() }
    );
  });

  it.each([
    ['bad/id', new Error('not explicit')],
    ['experiment-1', new Error('read failed')],
    ['experiment-1', 'schema failure'],
  ])('reports resolution and read failures', async (value, failure) => {
    const errors: string[] = [];
    if (value === 'experiment-1') {
      parse.mockImplementationOnce(() => {
        throw failure;
      });
    }
    await baselinePromoteCommand(
      value,
      { channel: 'production', target: 'candidate' },
      { cwd: 'project', stderr: (message) => errors.push(message) }
    );
    expect(errors.length).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it('rejects results without target aggregates and string failures', async () => {
    parse.mockReturnValue({ experiment_id: 'experiment-1', aggregates: [] });
    const errors: string[] = [];
    await baselinePromoteCommand(
      'experiment-1',
      { channel: 'production', target: 'missing' },
      { cwd: 'project', stderr: (message) => errors.push(message) }
    );
    snapshotWrite.mockRejectedValueOnce('write failure');
    parse.mockReturnValue(experiment());
    await baselinePromoteCommand(
      'experiment-1',
      { channel: 'production', target: 'candidate' },
      { cwd: 'project', stderr: (message) => errors.push(message) }
    );
    expect(errors.join('\n')).toContain('write failure');
  });

  it('shows JSON, channels, and raw snapshots', async () => {
    const output: string[] = [];
    await baselineShowCommand(
      'production',
      { json: true },
      { cwd: 'project', stdout: (message) => output.push(message) }
    );
    await baselineShowCommand(
      'production',
      {},
      { cwd: 'project', stdout: (message) => output.push(message) }
    );
    channelResolve.mockResolvedValueOnce({
      snapshot: {
        digest: 'digest-2',
        result: { experiment_id: 'experiment-2' },
      },
      channel: undefined,
    });
    await baselineShowCommand(
      'digest-2',
      {},
      { cwd: 'project', stdout: (message) => output.push(message) }
    );
    expect(output.join('\n')).toContain('Baseline channel production');
    expect(output.join('\n')).toContain('Baseline snapshot');
  });

  it('reports show failures and uses default dependency fallbacks', async () => {
    channelResolve.mockRejectedValueOnce(new Error('resolve failed'));
    await baselineShowCommand('missing', {});
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    snapshotWrite.mockRejectedValueOnce(new Error('promote failed'));
    await baselinePromoteCommand('experiment-1', {
      channel: 'production',
      target: 'candidate',
    });
    expect(process.exitCode).toBe(1);
  });

  it('registers promote and show actions', () => {
    const actions: unknown[] = [];
    const chain = {
      command: jest.fn(() => chain),
      description: jest.fn(() => chain),
      argument: jest.fn(() => chain),
      requiredOption: jest.fn(() => chain),
      option: jest.fn(() => chain),
      action: jest.fn((callback) => {
        actions.push(callback);
        return chain;
      }),
    };
    registerBaselineCommand(chain as never);
    expect(actions).toHaveLength(2);
  });
});
