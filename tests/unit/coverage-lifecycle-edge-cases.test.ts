import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { spawn } from 'child_process';
import { ScriptPreExecution } from '../../src/pre-execution/script.js';
import type { PreExecutionContext } from '../../src/pre-execution/base.js';
import { DatabasePostEvaluation } from '../../src/post-evaluation/database.js';
import { ScriptPostEvaluation } from '../../src/post-evaluation/script.js';
import { WebhookPostEvaluation } from '../../src/post-evaluation/webhook.js';
import type { PostEvaluationContext } from '../../src/post-evaluation/base.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    appendFile: jest.fn(actual.appendFile),
    mkdir: jest.fn(actual.mkdir),
    writeFile: jest.fn(actual.writeFile),
  };
});

jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  return { ...actual, request: jest.fn() };
});

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https');
  return { ...actual, request: jest.fn() };
});

interface ScriptRunner {
  runScript(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface WebhookInternals {
  makeRequest(config: Record<string, unknown>, payload: unknown): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = jest.fn();
}

class FakeResponse extends EventEmitter {
  statusCode?: number;
}

class FakeRequest extends EventEmitter {
  destroy = jest.fn();
  write = jest.fn();
  end = jest.fn();
}

const asScriptRunner = (
  value: ScriptPreExecution | ScriptPostEvaluation
): ScriptRunner => value as unknown as ScriptRunner;

const asWebhookInternals = (value: WebhookPostEvaluation): WebhookInternals =>
  value as unknown as WebhookInternals;

function resultsBundle(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'description',
      config_file: 'case.yaml',
      config_hash: 'hash',
      repo: 'https://example.com/repo.git',
      branch: 'main',
      commit: 'commit',
    },
    execution: {
      started_at: '2026-07-29T00:00:00.000Z',
      completed_at: '2026-07-29T00:00:01.000Z',
      duration_ms: 1000,
      youbencha_version: '1.0.0',
      environment: {
        os: 'test',
        node_version: '20.0.0',
        workspace_dir: '/workspace',
      },
    },
    agent: {
      type: 'copilot-cli',
      youbencha_log_path: 'youbencha.log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [
      {
        evaluator: 'git-diff',
        status: 'passed',
        metrics: { changed: 1 },
        message: 'passed',
        duration_ms: 1,
        timestamp: '2026-07-29T00:00:01.000Z',
      },
    ],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

function postContext(config: Record<string, unknown>): PostEvaluationContext {
  return {
    resultsBundle: resultsBundle(),
    resultsBundlePath: '/workspace/results.json',
    artifactsDir: '/workspace/artifacts',
    workspaceDir: '/workspace',
    config,
  };
}

function preContext(config: Record<string, unknown>): PreExecutionContext {
  return {
    workspaceDir: '/workspace',
    repoDir: '/workspace/repo',
    artifactsDir: '/workspace/artifacts',
    testCaseName: 'case',
    repoUrl: 'https://example.com/repo.git',
    config,
  };
}

describe('lifecycle coverage edge cases', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-lifecycle-coverage-')
    );
    jest.clearAllMocks();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test.each([
    ['pre', new ScriptPreExecution(), preContext],
    ['post', new ScriptPostEvaluation(), postContext],
  ] as const)(
    '%s script preconditions catch malformed context access',
    async (_name, script, contextFactory) => {
      const context = contextFactory({
        command: {
          trim: () => {
            throw 'bad config';
          },
        },
      });
      await expect(script.checkPreconditions(context)).resolves.toBe(false);
      const errorContext = contextFactory({
        command: {
          trim: () => {
            throw new Error('bad config error');
          },
        },
      });
      await expect(script.checkPreconditions(errorContext)).resolves.toBe(
        false
      );
      await expect(
        script.checkPreconditions(contextFactory({ command: '' }))
      ).resolves.toBe(false);
      await expect(
        script.checkPreconditions(contextFactory({ command: 'command' }))
      ).resolves.toBe(true);
    }
  );

  test('covers pre-execution defaults, replacements, failures, and non-Error exceptions', async () => {
    const executor = new ScriptPreExecution();
    const runner = asScriptRunner(executor);
    const run = jest
      .spyOn(runner, 'runScript')
      .mockResolvedValueOnce({
        stdout: 'x'.repeat(1100),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'bad', exitCode: 2 })
      .mockRejectedValueOnce('string failure')
      .mockRejectedValueOnce(new Error('error failure'));

    const success = await executor.execute(
      preContext({
        command: 'command',
        args: [
          '${WORKSPACE_DIR}',
          '${REPO_DIR}',
          '${ARTIFACTS_DIR}',
          '${TEST_CASE_NAME}',
          '${REPO_URL}',
          '${BRANCH}',
        ],
      })
    );
    expect(success.status).toBe('success');
    expect(success.metadata?.stdout).toHaveLength(1000);
    expect(run.mock.calls[0]?.[1]).toEqual([
      '/workspace',
      '/workspace/repo',
      '/workspace/artifacts',
      'case',
      'https://example.com/repo.git',
      '',
    ]);
    expect(run.mock.calls[0]?.[2]).toBe('/workspace');
    expect(run.mock.calls[0]?.[4]).toBe(30000);

    const failure = await executor.execute(
      preContext({
        command: 'command',
        working_dir: temporaryDirectory,
        timeout_ms: 5,
        env: { EXTRA: 'value' },
      })
    );
    expect(failure).toMatchObject({
      status: 'failed',
      metadata: { exit_code: 2 },
      error: { stack_trace: 'bad' },
    });
    expect(run.mock.calls[1]?.[2]).toBe(temporaryDirectory);
    expect(run.mock.calls[1]?.[4]).toBe(5);

    const exception = await executor.execute(
      preContext({ command: 'command' })
    );
    expect(exception.error).toEqual({ message: 'string failure' });
    expect(
      await executor.execute(preContext({ command: 'command' }))
    ).toMatchObject({
      error: { message: 'error failure', stack_trace: expect.any(String) },
    });

    const defaultsExecutor = new ScriptPreExecution();
    const defaultsRun = jest
      .spyOn(asScriptRunner(defaultsExecutor), 'runScript')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    delete process.env.PATH;
    delete process.env.HOME;
    try {
      await defaultsExecutor.execute(preContext({ command: 'command' }));
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
    expect(defaultsRun.mock.calls[0]?.[3]).toMatchObject({
      PATH: '',
      HOME: '',
    });
  });

  test('covers post-execution defaults, replacements, failures, and exceptions', async () => {
    const evaluator = new ScriptPostEvaluation();
    const runner = asScriptRunner(evaluator);
    const run = jest
      .spyOn(runner, 'runScript')
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'warn', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'out', stderr: 'bad', exitCode: 7 })
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockRejectedValueOnce('string failure');

    const success = await evaluator.execute(
      postContext({
        command: 'command',
        args: [
          '${RESULTS_PATH}',
          '${ARTIFACTS_DIR}',
          '${WORKSPACE_DIR}',
          '${TEST_CASE_NAME}',
          '${OVERALL_STATUS}',
        ],
      })
    );
    expect(success.status).toBe('success');
    expect(run.mock.calls[0]?.[1]).toEqual([
      '/workspace/results.json',
      '/workspace/artifacts',
      '/workspace',
      'case',
      'passed',
    ]);
    expect(run.mock.calls[0]?.[2]).toBe(process.cwd());
    expect(run.mock.calls[0]?.[4]).toBe(30000);

    const failure = await evaluator.execute(
      postContext({
        command: 'command',
        working_dir: temporaryDirectory,
        timeout_ms: 10,
        env: { EXTRA: 'value' },
      })
    );
    expect(failure).toMatchObject({
      status: 'failed',
      metadata: { exit_code: 7 },
      error: { stack_trace: 'bad' },
    });
    expect(run.mock.calls[1]?.[2]).toBe(temporaryDirectory);

    expect(
      await evaluator.execute(postContext({ command: 'command' }))
    ).toMatchObject({ error: { message: 'spawn failed' } });
    expect(
      await evaluator.execute(postContext({ command: 'command' }))
    ).toMatchObject({
      error: { message: 'string failure', stack_trace: undefined },
    });
  });

  test.each([
    ['pre', new ScriptPreExecution()],
    ['post', new ScriptPostEvaluation()],
  ] as const)(
    '%s script runner handles output and close codes',
    async (_name, script) => {
      const child = new FakeChild();
      const spawnMock = spawn as jest.MockedFunction<typeof spawn>;
      spawnMock.mockReturnValue(
        child as unknown as ChildProcessWithoutNullStreams
      );
      const stdoutWrite = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const stderrWrite = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const pending = asScriptRunner(script).runScript(
        'command',
        [],
        temporaryDirectory,
        {},
        10000
      );
      child.stdout.emit('data', Buffer.from('out'));
      child.stderr.emit('data', Buffer.from('err'));
      child.emit('close', null);
      await expect(pending).resolves.toEqual({
        stdout: 'out',
        stderr: 'err',
        exitCode: 0,
      });
      if (script instanceof ScriptPreExecution) {
        expect(stdoutWrite).toHaveBeenCalled();
        expect(stderrWrite).toHaveBeenCalled();
      }
    }
  );

  test.each([
    ['pre', new ScriptPreExecution()],
    ['post', new ScriptPostEvaluation()],
  ] as const)(
    '%s script runner handles errors and timeouts',
    async (_name, script) => {
      const spawnMock = spawn as jest.MockedFunction<typeof spawn>;
      const erroredChild = new FakeChild();
      spawnMock.mockReturnValueOnce(
        erroredChild as unknown as ChildProcessWithoutNullStreams
      );
      const errored = asScriptRunner(script).runScript(
        'command',
        [],
        temporaryDirectory,
        {},
        10000
      );
      erroredChild.emit('error', new Error('child failed'));
      await expect(errored).rejects.toThrow('child failed');

      jest.useFakeTimers();
      const timedChild = new FakeChild();
      spawnMock.mockReturnValueOnce(
        timedChild as unknown as ChildProcessWithoutNullStreams
      );
      const timed = asScriptRunner(script).runScript(
        'command',
        [],
        temporaryDirectory,
        {},
        10
      );
      jest.advanceTimersByTime(10);
      expect(timedChild.kill).toHaveBeenCalledWith('SIGTERM');
      jest.advanceTimersByTime(2000);
      expect(timedChild.kill).toHaveBeenCalledWith('SIGKILL');
      timedChild.emit('close', 1);
      await expect(timed).rejects.toThrow('timed out after 10ms');
    }
  );

  test('covers database precondition and export variants', async () => {
    const evaluator = new DatabasePostEvaluation();
    const output = path.join(temporaryDirectory, 'results.jsonl');
    const mkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
    mkdir.mockRejectedValueOnce('mkdir failed');
    await expect(
      evaluator.checkPreconditions(
        postContext({ type: 'json-file', output_path: output })
      )
    ).resolves.toBe(false);
    mkdir.mockRejectedValueOnce(new Error('mkdir error'));
    await expect(
      evaluator.checkPreconditions(
        postContext({ type: 'json-file', output_path: output })
      )
    ).resolves.toBe(false);
    await expect(
      evaluator.checkPreconditions(
        postContext({ type: 'json-file', output_path: output })
      )
    ).resolves.toBe(true);

    const summary = await evaluator.execute(
      postContext({
        type: 'json-file',
        output_path: output,
        include_full_bundle: false,
        append: false,
      })
    );
    expect(summary.status).toBe('success');
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toMatchObject({
      version: '1.0.0',
      evaluators: [{ evaluator: 'git-diff', status: 'passed' }],
    });

    const full = await evaluator.execute(
      postContext({
        type: 'json-file',
        output_path: output,
        include_full_bundle: true,
        append: true,
      })
    );
    expect(full.status).toBe('success');

    const noWriter = await evaluator.execute(
      postContext({
        type: 'future-database',
        output_path: output,
        include_full_bundle: true,
        append: false,
      })
    );
    expect(noWriter.status).toBe('success');

    const append = fs.appendFile as jest.MockedFunction<typeof fs.appendFile>;
    append.mockRejectedValueOnce('write failed');
    expect(
      await evaluator.execute(
        postContext({
          type: 'json-file',
          output_path: output,
          include_full_bundle: true,
          append: true,
        })
      )
    ).toMatchObject({ status: 'failed', error: { message: 'write failed' } });
    append.mockRejectedValueOnce(new Error('write error'));
    expect(
      await evaluator.execute(
        postContext({
          type: 'json-file',
          output_path: output,
          include_full_bundle: true,
          append: true,
        })
      )
    ).toMatchObject({
      status: 'failed',
      error: { message: 'write error', stack_trace: expect.any(String) },
    });
  });

  test('covers webhook execute payloads, retries, and outer failures', async () => {
    const evaluator = new WebhookPostEvaluation();
    const internals = asWebhookInternals(evaluator);
    await expect(
      evaluator.checkPreconditions(postContext({ url: 'not a url' }))
    ).resolves.toBe(false);
    await expect(
      evaluator.checkPreconditions(
        postContext(
          new Proxy(
            {},
            {
              get: (): never => {
                throw new Error('url getter error');
              },
            }
          )
        )
      )
    ).resolves.toBe(false);
    await expect(
      evaluator.checkPreconditions(
        postContext({ url: 'https://example.com/hook' })
      )
    ).resolves.toBe(true);
    const request = jest
      .spyOn(internals, 'makeRequest')
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce('first')
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'));
    jest.spyOn(internals, 'sleep').mockResolvedValue();

    expect(
      await evaluator.execute(
        postContext({
          url: 'https://example.com/hook',
          include_artifacts: true,
          retry_on_failure: false,
        })
      )
    ).toMatchObject({ status: 'success', metadata: { attempts: 1 } });
    expect(request.mock.calls[0]?.[1]).toHaveProperty('artifacts_path');

    expect(
      await evaluator.execute(
        postContext({
          url: 'https://example.com/hook',
          include_artifacts: false,
          retry_on_failure: false,
        })
      )
    ).toMatchObject({ status: 'success' });

    expect(
      await evaluator.execute(
        postContext({
          url: 'https://example.com/hook',
          retry_on_failure: true,
        })
      )
    ).toMatchObject({
      status: 'failed',
      error: { message: 'third' },
    });

    const malformed = postContext(
      new Proxy(
        {},
        {
          get: (): never => {
            throw 'invalid context';
          },
        }
      )
    );
    expect(await evaluator.execute(malformed)).toMatchObject({
      status: 'failed',
      error: { message: 'invalid context', stack_trace: undefined },
    });

    const malformedError = postContext(
      new Proxy(
        {},
        {
          get: (): never => {
            throw new Error('invalid context error');
          },
        }
      )
    );
    expect(await evaluator.execute(malformedError)).toMatchObject({
      status: 'failed',
      error: {
        message: 'invalid context error',
        stack_trace: expect.any(String),
      },
    });

    const unknownErrorEvaluator = new WebhookPostEvaluation();
    jest
      .spyOn(asWebhookInternals(unknownErrorEvaluator), 'makeRequest')
      .mockRejectedValue(new Error(''));
    expect(
      await unknownErrorEvaluator.execute(
        postContext({
          url: 'https://example.com/hook',
          retry_on_failure: false,
        })
      )
    ).toMatchObject({ error: { message: 'Unknown error' } });

    jest.useFakeTimers();
    const slept = asWebhookInternals(new WebhookPostEvaluation()).sleep(5);
    jest.advanceTimersByTime(5);
    await expect(slept).resolves.toBeUndefined();
  });

  test.each([
    ['http', http, 'http://example.com/hook?x=1', 80],
    ['https', https, 'https://example.com:8443/hook?x=1', '8443'],
    ['https-default', https, 'https://example.com/hook?x=1', 443],
  ] as const)(
    '%s webhook request handles successful responses',
    async (_name, client, url, expectedPort) => {
      const evaluator = new WebhookPostEvaluation();
      const response = new FakeResponse();
      response.statusCode = 204;
      const request = new FakeRequest();
      const requestMock = client.request as jest.MockedFunction<
        typeof client.request
      >;
      requestMock.mockImplementationOnce((options, callback) => {
        expect(options).toMatchObject({
          port: expectedPort,
          path: '/hook?x=1',
          method: 'POST',
          timeout: 5000,
        });
        callback?.(response as unknown as http.IncomingMessage);
        return request as unknown as http.ClientRequest;
      });

      const pending = asWebhookInternals(evaluator).makeRequest(
        { url },
        { value: true }
      );
      response.emit('data', Buffer.from('ok'));
      response.emit('end');
      await expect(pending).resolves.toBeUndefined();
      expect(request.write).toHaveBeenCalled();
      expect(request.end).toHaveBeenCalled();
    }
  );

  test('webhook request handles bad status, request errors, and timeout', async () => {
    const evaluator = new WebhookPostEvaluation();
    const internals = asWebhookInternals(evaluator);
    const requestMock = http.request as jest.MockedFunction<
      typeof http.request
    >;

    const badResponse = new FakeResponse();
    badResponse.statusCode = 500;
    const badRequest = new FakeRequest();
    requestMock.mockImplementationOnce((_options, callback) => {
      callback?.(badResponse as unknown as http.IncomingMessage);
      return badRequest as unknown as http.ClientRequest;
    });
    const bad = internals.makeRequest(
      {
        url: 'http://example.com',
        method: 'PATCH',
        headers: { Authorization: 'redacted' },
        timeout_ms: 10,
      },
      {}
    );
    badResponse.emit('data', Buffer.from('failure'));
    badResponse.emit('end');
    await expect(bad).rejects.toThrow('status 500: failure');

    const erroredRequest = new FakeRequest();
    requestMock.mockReturnValueOnce(
      erroredRequest as unknown as http.ClientRequest
    );
    const errored = internals.makeRequest(
      { url: 'http://example.com', timeout_ms: 10 },
      {}
    );
    erroredRequest.emit('error', new Error('socket failed'));
    await expect(errored).rejects.toThrow('socket failed');

    const timedRequest = new FakeRequest();
    requestMock.mockReturnValueOnce(
      timedRequest as unknown as http.ClientRequest
    );
    const timed = internals.makeRequest(
      { url: 'http://example.com', timeout_ms: 10 },
      {}
    );
    timedRequest.emit('timeout');
    await expect(timed).rejects.toThrow('timed out after 10ms');
    expect(timedRequest.destroy).toHaveBeenCalled();
  });
});
