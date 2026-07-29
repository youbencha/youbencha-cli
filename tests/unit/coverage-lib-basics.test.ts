import ora from 'ora';
import { MarkdownReporter } from '../../src/reporters/markdown.js';
import {
  createSpinner,
  failure,
  information,
  showStep,
  success,
  warning,
  withMultiProgress,
  withProgress,
} from '../../src/lib/progress.js';
import { isProduction, sanitizeError } from '../../src/lib/error-utils.js';
import { formatUserError, UserErrors } from '../../src/lib/user-errors.js';
import { writeDefaultMarkdownReport } from '../../src/lib/results-output.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

jest.mock('ora', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../src/reporters/markdown.js', () => ({
  MarkdownReporter: jest.fn(),
}));

interface FakeOra {
  text: string;
  isSpinning: boolean;
  start: jest.Mock;
  succeed: jest.Mock;
  fail: jest.Mock;
  warn: jest.Mock;
  info: jest.Mock;
  stop: jest.Mock;
}

function fakeOra(): FakeOra {
  return {
    text: '',
    isSpinning: false,
    start: jest.fn(function (this: FakeOra) {
      this.isSpinning = true;
      return this;
    }),
    succeed: jest.fn(),
    fail: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    stop: jest.fn(function (this: FakeOra) {
      this.isSpinning = false;
      return this;
    }),
  };
}

describe('library coverage: progress and user-facing helpers', () => {
  let spinner: FakeOra;

  beforeEach(() => {
    spinner = fakeOra();
    jest.mocked(ora).mockReturnValue(spinner as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates every spinner operation and supports optional text', () => {
    const progress = createSpinner();
    expect(ora).toHaveBeenCalledWith({ text: '', color: 'cyan' });

    expect(progress.start()).toBe(progress);
    expect(progress.start('started')).toBe(progress);
    expect(spinner.text).toBe('started');
    expect(progress.text('updated')).toBe(progress);
    expect(spinner.text).toBe('updated');
    expect(progress.succeed()).toBe(progress);
    expect(progress.succeed('done')).toBe(progress);
    expect(progress.fail()).toBe(progress);
    expect(progress.fail('failed')).toBe(progress);
    expect(progress.warn()).toBe(progress);
    expect(progress.warn('warning')).toBe(progress);
    expect(progress.info()).toBe(progress);
    expect(progress.info('info')).toBe(progress);
    expect(progress.isSpinning()).toBe(true);
    expect(progress.stop()).toBe(progress);
    expect(progress.isSpinning()).toBe(false);
  });

  it('runs successful and failing progress operations with defaults and overrides', async () => {
    await expect(withProgress('work', async () => 42)).resolves.toBe(42);
    expect(spinner.succeed).toHaveBeenCalledWith('work');

    await expect(
      withProgress('custom', async () => 'ok', {
        successText: 'success',
        failText: 'failure',
      })
    ).resolves.toBe('ok');
    expect(spinner.succeed).toHaveBeenCalledWith('success');

    const expected = new Error('boom');
    await expect(
      withProgress('broken', async () => {
        throw expected;
      })
    ).rejects.toBe(expected);
    expect(spinner.fail).toHaveBeenCalledWith('broken - Failed');

    await expect(
      withProgress(
        'broken-custom',
        async () => {
          throw expected;
        },
        { failText: 'custom failure' }
      )
    ).rejects.toBe(expected);
    expect(spinner.fail).toHaveBeenCalledWith('custom failure');
  });

  it('runs multi-step and one-shot progress helpers', async () => {
    await expect(
      withMultiProgress([
        { text: 'one', operation: async () => 1 },
        {
          text: 'two',
          operation: async () => 2,
          successText: 'second complete',
          failText: 'second failed',
        },
      ])
    ).resolves.toEqual([1, 2]);

    expect(showStep(2, 3, 'testing').isSpinning()).toBe(true);
    success('success');
    failure('failure');
    warning('warning');
    information('information');
    expect(spinner.succeed).toHaveBeenCalledWith('success');
    expect(spinner.fail).toHaveBeenCalledWith('failure');
    expect(spinner.warn).toHaveBeenCalledWith('warning');
    expect(spinner.info).toHaveBeenCalledWith('information');
  });

  it('formats errors with and without actions and technical details', () => {
    expect(
      formatUserError({
        title: 'Problem',
        description: 'Description',
        actions: ['First', 'Second'],
        technicalDetails: 'details',
      })
    ).toContain('2. Second');

    const minimal = formatUserError({
      title: 'Problem',
      description: 'Description',
      actions: [],
    });
    expect(minimal).not.toContain('What to do');
    expect(minimal).not.toContain('Technical details');
  });

  it('constructs every predefined user error variant', () => {
    const errors = [
      UserErrors.agentNotInstalled('copilot-cli'),
      UserErrors.agentNotInstalled('claude-code'),
      UserErrors.invalidConfig(['one', 'two']),
      UserErrors.cloneFailed('https://example.com/repo.git', 'denied'),
      UserErrors.expectedBranchNotFound('expected', 'repo'),
      UserErrors.noEvaluators(),
      UserErrors.workspacePermissionDenied('/workspace'),
      UserErrors.agentExecutionFailed('codex-cli', 7),
      UserErrors.evaluatorDependencyMissing('judge', 'tool'),
      UserErrors.timeout('clone', 12_000),
      UserErrors.resultsNotFound('/results.json'),
      UserErrors.invalidEvaluatorConfig('judge', 'invalid'),
      UserErrors.gitNotInstalled(),
      UserErrors.unsupportedNodeVersion('18', '20'),
    ];

    expect(errors).toHaveLength(14);
    for (const error of errors) {
      expect(error.title).not.toBe('');
      expect(error.description).not.toBe('');
      expect(error.actions.length).toBeGreaterThan(0);
    }
    expect(errors[0].actions.join(' ')).toContain('copilot --version');
    expect(errors[1].actions.join(' ')).toContain('claude-code --version');
  });
});

describe('library coverage: error sanitization and report output', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    jest.restoreAllMocks();
  });

  it('sanitizes error messages and stacks across platforms', () => {
    const error = new Error(
      'failed at C:\\Users\\name\\secret.txt and /home/name/project/file.ts and /tmp/public'
    );
    error.stack =
      'Error\n at C:\\Users\\name\\secret.ts\n at /home/name/private.ts\n at /Users/name/private.ts';

    const sanitized = sanitizeError(error, true);
    expect(sanitized.message).toContain('[PATH]');
    expect(sanitized.message).toContain('/tmp/public');
    expect(sanitized.stack_trace).not.toContain('name\\secret');
    expect(sanitized.stack_trace).not.toContain('/home/name');
    expect(sanitized.stack_trace).not.toContain('/Users/name');

    expect(sanitizeError('plain failure', false)).toEqual({
      message: 'plain failure',
    });
  });

  it('uses NODE_ENV defaults for stack inclusion and production detection', () => {
    process.env.NODE_ENV = 'development';
    expect(sanitizeError(new Error('failure')).stack_trace).toBeDefined();
    expect(isProduction()).toBe(false);

    process.env.NODE_ENV = 'production';
    expect(sanitizeError(new Error('failure')).stack_trace).toBeUndefined();
    expect(isProduction()).toBe(true);
  });

  it('returns default result paths after writing the Markdown report', async () => {
    const writeToFile = jest.fn().mockResolvedValue(undefined);
    jest
      .mocked(MarkdownReporter)
      .mockImplementation(() => ({ writeToFile }) as never);
    const results = {
      execution: {
        environment: { workspace_dir: 'relative-workspace' },
      },
    } as ResultsBundle;

    const paths = await writeDefaultMarkdownReport(results);
    expect(paths.results).toMatch(
      /relative-workspace[\\/]artifacts[\\/]results\.json$/
    );
    expect(paths.report).toMatch(
      /relative-workspace[\\/]artifacts[\\/]report\.md$/
    );
    expect(writeToFile).toHaveBeenCalledWith(results, paths.report);
  });
});
