import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  buildCodexCommand,
  codexCliTesting,
  CodexCLIAdapter,
} from '../../src/adapters/codex-cli.js';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentExecutionTelemetry,
} from '../../src/adapters/base.js';
import type {
  CliProcessRequest,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

const executable: ResolvedExecutable = {
  path: path.join(os.tmpdir(), 'codex'),
  kind: 'native',
};
const timestamp = '2026-07-29T12:00:00.000Z';

function processResult(
  overrides: Partial<CliProcessResult> = {}
): CliProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutArtifactBytes: 0,
    stderrArtifactBytes: 0,
    stdoutArtifactTruncated: false,
    stderrArtifactTruncated: false,
    timedOut: false,
    ...overrides,
  };
}

type ProbeName = 'version' | 'global' | 'exec' | 'login';

function probeName(request: CliProcessRequest): ProbeName {
  if (request.args[0] === '--version') return 'version';
  if (request.args[0] === '--help') return 'global';
  if (request.args[0] === 'exec') return 'exec';
  return 'login';
}

function availabilityAdapter(
  outcomes: Partial<Record<ProbeName, CliProcessResult | Error | string>>,
  resolve: ResolvedExecutable | null = executable
): CodexCLIAdapter {
  return new CodexCLIAdapter({
    resolveExecutable: async (): Promise<ResolvedExecutable | undefined> =>
      resolve ?? undefined,
    runProcess: async (request): Promise<CliProcessResult> => {
      const outcome = outcomes[probeName(request)];
      if (outcome instanceof Error || typeof outcome === 'string') {
        throw outcome;
      }
      return (
        outcome ??
        processResult({
          stdout:
            probeName(request) === 'version'
              ? 'codex 1.2.3'
              : probeName(request) === 'global'
                ? '--ask-for-approval --search'
                : probeName(request) === 'exec'
                  ? '--json --ephemeral --color --sandbox --ignore-user-config -C'
                  : 'Logged in with ChatGPT',
        })
      );
    },
  });
}

function successfulEvents(final = 'done'): string {
  return [
    '{"type":"thread.started","thread_id":"thread"}',
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: final },
    }),
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}',
  ].join('\n');
}

describe('Codex CLI final deterministic coverage', () => {
  let root: string;
  let repoDir: string;
  let artifactsDir: string;
  let context: AgentExecutionContext;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'youbencha-codex-final-'));
    repoDir = path.join(root, 'repo');
    artifactsDir = path.join(root, 'artifacts');
    await Promise.all([
      mkdir(repoDir, { recursive: true }),
      mkdir(artifactsDir, { recursive: true }),
    ]);
    context = {
      workspaceDir: repoDir,
      repoDir,
      artifactsDir,
      config: { prompt: 'work' },
      timeout: 1_000,
      env: {},
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('covers command validation and constructor defaults', () => {
    expect(() =>
      buildCodexCommand({
        ...context,
        config: { prompt: 'x', reasoning_effort: 'impossible' },
      })
    ).toThrow('reasoning_effort');
    expect(
      buildCodexCommand({
        ...context,
        config: {
          prompt: 'x',
          ephemeral: false,
          ignore_user_config: false,
          ignore_rules: false,
          search: false,
        },
      }).effectiveConfig
    ).toMatchObject({
      ephemeral: false,
      ignore_user_config: false,
      ignore_rules: false,
      search: false,
    });
    expect(new CodexCLIAdapter()).toBeInstanceOf(CodexCLIAdapter);
  });

  test('covers unavailable and failed version diagnoses', async () => {
    await expect(
      availabilityAdapter({}, null).diagnoseAvailability()
    ).resolves.toMatchObject({
      installed: false,
      authenticated: false,
    });
    await expect(
      availabilityAdapter({}, null).checkAvailability()
    ).resolves.toBe(false);

    for (const version of [
      processResult({ error: new Error('version') }),
      processResult({ timedOut: true }),
      processResult({ exitCode: 2 }),
    ]) {
      await expect(
        availabilityAdapter({ version }).diagnoseAvailability({})
      ).resolves.toMatchObject({
        installed: false,
        authenticated: 'unknown',
      });
    }
  });

  test('covers every help and authentication diagnosis outcome', async () => {
    const persisted = await availabilityAdapter({}).diagnoseAvailability({});
    expect(persisted).toMatchObject({
      installed: true,
      authenticated: true,
      version: '1.2.3',
    });
    expect(persisted.messages).toContain(
      'Persisted Codex authentication is available.'
    );

    const unsupported = availabilityAdapter({
      global: processResult({ stdout: 'help without flags' }),
      exec: processResult({ stdout: '--json only' }),
      login: processResult({ exitCode: 1, stdout: 'Not logged in' }),
    });
    const unsupportedDiagnosis = await unsupported.diagnoseAvailability({});
    expect(unsupportedDiagnosis).toMatchObject({
      authenticated: false,
      installed: true,
    });
    expect(unsupportedDiagnosis.messages.join(' ')).toMatch(
      /ask-for-approval.*did not advertise/
    );
    await expect(unsupported.checkAvailability()).resolves.toBe(false);

    const envAuthenticated = availabilityAdapter({
      login: processResult({ exitCode: 1, stdout: 'status unavailable' }),
    });
    const envDiagnosis = await envAuthenticated.diagnoseAvailability({
      CODEX_API_KEY: 'available',
    });
    expect(envDiagnosis.messages).toContain(
      'CODEX_API_KEY is available for codex exec.'
    );

    for (const failure of [
      { error: new Error('help') },
      { timedOut: true },
      { exitCode: 2 },
    ]) {
      const failedResult = processResult(failure);
      const diagnosis = await availabilityAdapter({
        global: failedResult,
        exec: failedResult,
        login: failedResult,
      }).diagnoseAvailability({});
      expect(diagnosis.messages).toEqual(
        expect.arrayContaining([
          'Codex global capability probe was inconclusive.',
          'Codex exec capability probe was inconclusive.',
          'Codex authentication status could not be determined.',
        ])
      );
    }

    await expect(
      availabilityAdapter({
        version: 'non-error rejection',
      }).diagnoseAvailability({})
    ).resolves.toMatchObject({
      messages: ['Codex availability diagnostics failed.'],
    });
  });

  test('covers availability short-circuit combinations', async () => {
    const unauthenticated = availabilityAdapter({
      login: processResult({ exitCode: 1, stdout: 'logged out' }),
    });
    await expect(unauthenticated.checkAvailability()).resolves.toBe(false);

    const inconclusive = availabilityAdapter({
      global: processResult({ exitCode: 1 }),
      exec: processResult({ exitCode: 1 }),
      login: processResult({ exitCode: 1 }),
    });
    await expect(inconclusive.checkAvailability()).resolves.toBe(true);
  });

  test('covers capability and executable execution failures', async () => {
    const searchAdapter = availabilityAdapter({});
    (
      searchAdapter as unknown as { globalSearchSupported: boolean }
    ).globalSearchSupported = false;
    const searchResult = await searchAdapter.execute({
      ...context,
      config: { prompt: 'x', search: true },
    });
    expect(searchResult.output).toContain('search=true');

    const flagsAdapter = availabilityAdapter({});
    (
      flagsAdapter as unknown as { requiredExecSupported: boolean }
    ).requiredExecSupported = false;
    expect((await flagsAdapter.execute(context)).output).toContain(
      'required headless exec flags'
    );

    const missingAdapter = availabilityAdapter({}, null);
    expect((await missingAdapter.execute(context)).output).toContain(
      'not installed'
    );

    const throwingAdapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<never> => {
        throw 'non-error resolver rejection';
      },
    });
    const rejection = await throwingAdapter.execute(context);
    expect(rejection.output).toBe('non-error resolver rejection');
    expect(rejection.errors[0]?.stackTrace).toContain(
      'non-error resolver rejection'
    );

    const stacklessError = new Error('stackless');
    stacklessError.stack = undefined;
    const stacklessAdapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<never> => {
        throw stacklessError;
      },
    });
    expect(
      (await stacklessAdapter.execute(context)).errors[0]?.stackTrace
    ).toBeUndefined();
  });

  test('covers missing artifacts, timeouts, truncation, and process errors', async () => {
    const missing = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (): Promise<CliProcessResult> => processResult(),
    });
    expect((await missing.execute(context)).output).toContain(
      'did not produce its structured event artifact'
    );

    const secret = 'top-secret-value';
    const timedOut = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        const large = `${successfulEvents(secret)}\n${'x'.repeat(1_100_000)}`;
        await Promise.all([
          writeFile(request.stdoutArtifactPath, large),
          writeFile(request.stderrArtifactPath, large),
        ]);
        return processResult({
          exitCode: null,
          error: new Error(`process ${secret}`),
          timedOut: true,
          stdoutTruncated: true,
          stderrTruncated: true,
          stdoutArtifactTruncated: true,
          stderrArtifactTruncated: true,
          stdoutArtifactRedactionCount: 1,
          stderrArtifactRedactionCount: 1,
        });
      },
    });
    const timeoutResult = await timedOut.execute({
      ...context,
      timeout: 0,
      env: { CODEX_API_KEY: secret },
      config: { prompt: 'x', output_limit_bytes: 1 },
    });
    expect(timeoutResult.status).toBe('timeout');
    expect(
      timeoutResult.errors.map((error) => error.message).join(' ')
    ).toMatch(/timed out/);
    expect(timeoutResult.telemetry?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('stdout preview'),
        expect.stringContaining('stderr preview'),
        expect.stringContaining('Credential values'),
      ])
    );

    const processError = await executeWithEvents(
      context,
      successfulEvents(),
      processResult({ error: new Error('spawn failed') })
    );
    expect(processError.status).toBe('failed');
    expect(processError.exitCode).toBe(0);

    const missingStderrAdapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await writeFile(request.stdoutArtifactPath, successfulEvents());
        return processResult({ stderrArtifactBytes: 17 });
      },
    });
    await expect(missingStderrAdapter.execute(context)).resolves.toMatchObject({
      status: 'success',
    });

    const expandingRedaction = await executeWithEvents(
      {
        ...context,
        env: { CODEX_API_KEY: 'abcd' },
        config: { prompt: 'x', output_limit_bytes: 100 },
      },
      successfulEvents('abcd'.repeat(20)),
      processResult()
    );
    expect(expandingRedaction.telemetry?.diagnostics).toContain(
      'Credential values were redacted from durable Codex artifacts.'
    );
  });

  test('covers incomplete protocol and stderr classifications', async () => {
    const incomplete = await executeWithEvents(
      context,
      '{"type":"thread.started","thread_id":"thread"}',
      processResult()
    );
    expect(incomplete).toMatchObject({ status: 'failed', exitCode: 1 });

    const diagnostic = await executeWithEvents(
      context,
      `${successfulEvents()}\nnot-json`,
      processResult()
    );
    expect(diagnostic.telemetry?.diagnostics).not.toEqual([]);

    for (const [stderr, expected] of [
      ['authentication failed', 'authentication failed'],
      ['model not found', 'model is unavailable'],
      ['sandbox permission denied', 'sandbox or policy'],
      ['miscellaneous failure', 'retained stderr'],
      ['', ''],
    ]) {
      expect(
        codexCliTesting.stderrPreview(processResult({ stderr }))
      ).toContain(expected);
    }
  });

  test('normalizes fallback, empty, and complete telemetry', () => {
    const base: AgentExecutionResult = {
      exitCode: 0,
      status: 'success',
      output: '',
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 1,
      errors: [],
    };
    const adapter = availabilityAdapter({});
    const fallback = adapter.normalizeLog(successfulEvents('fallback'), base);
    expect(fallback.messages[0]?.content).toBe('fallback');

    const empty = adapter.normalizeLog('', base);
    expect(empty).toMatchObject({
      agent: { version: 'unknown' },
      model: { name: 'unknown', parameters: {} },
      messages: [{ content: 'No output captured' }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        measurement_source: 'unavailable',
      },
    });

    const telemetry: AgentExecutionTelemetry = {
      cliVersion: '9.9.9',
      configuredModel: 'configured',
      model: 'reported',
      effectiveConfig: { sandbox: 'read-only' },
      messages: [{ role: 'assistant', content: 'telemetry', timestamp }],
      usage: {
        promptTokens: 4,
        cachedPromptTokens: 2,
        completionTokens: 3,
        reasoningTokens: 1,
        source: 'measured',
      },
    };
    const normalized = adapter.normalizeLog('', { ...base, telemetry });
    expect(normalized).toMatchObject({
      agent: { version: '9.9.9' },
      model: { name: 'reported' },
      usage: { total_tokens: 7 },
      messages: [{ content: 'telemetry' }],
    });
    telemetry.usage = { ...telemetry.usage, totalTokens: 10 };
    expect(
      adapter.normalizeLog('', { ...base, telemetry }).usage.total_tokens
    ).toBe(10);

    const withoutUsage = adapter.normalizeLog('', {
      ...base,
      telemetry: {},
      errors: [
        {
          message: 'normalized error',
          timestamp,
          stackTrace: 'stack',
        },
      ],
    });
    expect(withoutUsage.usage.measurement_source).toBe('unavailable');
    expect(withoutUsage.errors).toEqual([
      {
        message: 'normalized error',
        timestamp,
        stack_trace: 'stack',
      },
    ]);
  });

  test('covers prompt containment and artifact directory containment', async () => {
    const actualRepo = path.join(root, 'actual-repo');
    const linkedRepo = path.join(root, 'linked-repo');
    await mkdir(actualRepo);
    await writeFile(path.join(actualRepo, 'prompt.txt'), 'prompt');
    await symlink(actualRepo, linkedRepo, 'junction');
    await expect(
      codexCliTesting.loadPrompt({
        ...context,
        repoDir: linkedRepo,
        config: { prompt_file: 'prompt.txt' },
      })
    ).rejects.toThrow('within repoDir');

    const outside = path.join(root, 'outside-directory');
    await mkdir(outside);
    await symlink(outside, path.join(actualRepo, 'external.txt'), 'junction');
    await expect(
      codexCliTesting.loadPrompt({
        ...context,
        repoDir: actualRepo,
        config: { prompt_file: 'external.txt' },
      })
    ).rejects.toThrow('within repoDir');

    const artifactRoot = path.join(root, 'safe-artifacts');
    const outsideArtifactDirectory = path.join(
      root,
      'outside-artifact-directory'
    );
    await Promise.all([mkdir(artifactRoot), mkdir(outsideArtifactDirectory)]);
    await symlink(
      outsideArtifactDirectory,
      path.join(artifactRoot, 'linked'),
      'junction'
    );
    await expect(
      codexCliTesting.validatedSubdirectory(artifactRoot, 'linked')
    ).rejects.toThrow('escaped artifactsDir');
  });

  test('covers sanitizer backpressure, failure cleanup, and helper fallbacks', async () => {
    const largeArtifact = path.join(root, 'large.log');
    await writeFile(largeArtifact, 'z'.repeat(200_000));
    await expect(
      codexCliTesting.sanitizeArtifact(largeArtifact, 300_000, [])
    ).resolves.toMatchObject({
      outputBytes: 200_000,
      truncated: false,
    });

    const directoryArtifact = path.join(root, 'directory-artifact');
    await mkdir(directoryArtifact);
    await expect(
      codexCliTesting.sanitizeArtifact(directoryArtifact, 100, [])
    ).rejects.toBeDefined();

    const fakeOutput = new EventEmitter() as EventEmitter &
      NodeJS.WritableStream;
    const rejectedDrain = codexCliTesting.waitForDrain(fakeOutput);
    fakeOutput.emit('error', new Error('drain failed'));
    await expect(rejectedDrain).rejects.toThrow('drain failed');

    expect(
      codexCliTesting.credentialValues({
        EMPTY_TOKEN: '',
        SHORT_TOKEN: 'abc',
        ORDINARY: 'long-value',
        ACCESS_TOKEN: 'long-value',
      })
    ).toEqual(['long-value']);
    expect(codexCliTesting.redactionVariants(['plain', 'a"b'])).toEqual(
      expect.arrayContaining(['plain', 'a\\"b', 'a"b'])
    );
    const redactor = new codexCliTesting.StreamingSecretRedactor([
      'later',
      'early',
    ]);
    expect(
      `${redactor.push('early then later')}${redactor.finish()}`
    ).toContain('[REDACTED]');
    expect(codexCliTesting.redactHome(os.homedir())).toContain('<home>');
    const outsideHome = path.parse(root).root;
    expect(codexCliTesting.redactHome(outsideHome)).toBe(
      path.resolve(outsideHome)
    );

    await writeFile(path.join(root, 'package.json'), '{}');
    const originalDirectory = process.cwd();
    process.chdir(root);
    try {
      expect(codexCliTesting.packageVersion()).toBe('unknown');
      await writeFile(path.join(root, 'package.json'), 'not-json');
      expect(codexCliTesting.packageVersion()).toBe('unknown');
    } finally {
      process.chdir(originalDirectory);
    }
  });
});

async function executeWithEvents(
  context: AgentExecutionContext,
  events: string,
  outcome: CliProcessResult
): Promise<AgentExecutionResult> {
  const adapter = new CodexCLIAdapter({
    resolveExecutable: async () => executable,
    runProcess: async (request): Promise<CliProcessResult> => {
      await Promise.all([
        writeFile(request.stdoutArtifactPath, events),
        writeFile(request.stderrArtifactPath, outcome.stderr),
      ]);
      return outcome;
    },
  });
  return adapter.execute(context);
}
