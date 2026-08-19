import {
  sandboxKillCommand,
  sandboxListCommand,
  sandboxReapCommand,
} from '../../src/cli/commands/sandbox.js';
import type { E2BSandboxInfo } from '../../src/e2b/index.js';

function info(id: string): E2BSandboxInfo {
  return {
    sandboxId: id,
    templateId: 'template',
    buildId: 'build',
    lifecycle: 'paused',
    secureAccess: true,
    resources: { cpu_count: 2, memory_mb: 4096 },
    network: { inbound: 'none', outbound: 'none' },
    metadata: {
      owner: 'youbencha',
      project: 'project',
      experimentId: 'experiment',
      cellId: 'a'.repeat(64),
      attemptId: 'attempt',
      targetId: 'candidate',
      ownershipNonceHash: 'b'.repeat(64),
      intendedExpiryAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('sandbox CLI', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('lists, reaps, and kills only through the ownership-checking service', async () => {
    const output: string[] = [];
    const killed: string[] = [];
    const service = {
      list: async (): Promise<E2BSandboxInfo[]> => [info('sandbox-1')],
      reap: async (): Promise<E2BSandboxInfo[]> => [info('sandbox-1')],
      kill: async (sandboxId: string): Promise<void> => {
        killed.push(sandboxId);
      },
    };
    await sandboxListCommand(
      { experiment: 'experiment' },
      { service, stdout: (message) => output.push(message) }
    );
    await sandboxReapCommand(
      { experiment: 'experiment' },
      { service, stdout: (message) => output.push(message) }
    );
    await sandboxKillCommand('sandbox-2', {
      service,
      stdout: (message) => output.push(message),
    });

    expect(output.join('\n')).toContain(
      'sandbox-1\tpaused\texperiment\tcandidate'
    );
    expect(output.join('\n')).toContain('Reaped 1');
    expect(killed).toEqual(['sandbox-2']);
  });
});
