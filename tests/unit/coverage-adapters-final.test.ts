import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentExecutionContext } from '../../src/adapters/base.js';
import {
  claudeCodeTesting,
  ClaudeCodeAdapter,
} from '../../src/adapters/claude-code.js';
import {
  claudeEventTesting,
  ClaudeStreamParser,
} from '../../src/adapters/claude-code-events.js';
import {
  codexCliTesting,
  CodexCLIAdapter,
} from '../../src/adapters/codex-cli.js';
import {
  codexEventTesting,
  CodexEventParser,
} from '../../src/adapters/codex-cli-events.js';
import {
  copilotCliTesting,
  CopilotCLIAdapter,
} from '../../src/adapters/copilot-cli.js';
import {
  CopilotEventParser,
  copilotEventTesting,
} from '../../src/adapters/copilot-cli-events.js';
import type {
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

function executionContext(
  root: string,
  config: Record<string, unknown> = {}
): AgentExecutionContext {
  return {
    workspaceDir: root,
    repoDir: root,
    artifactsDir: path.join(root, 'artifacts'),
    config,
    timeout: 1000,
    env: {},
  };
}

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

describe('remaining adapter helper and process boundaries', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-adapter-final-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('covers Claude value, capability, authentication, and redaction helpers', async () => {
    expect([...claudeCodeTesting.quotedChoices('"a", "b"')]).toEqual([
      'a',
      'b',
    ]);
    expect(
      claudeCodeTesting.parseClaudeCapabilities(
        '--permission-mode (choices: "auto", "manual") --effort (low, medium, high)'
      )
    ).toMatchObject({
      permissionModes: new Set(['auto', 'manual']),
      effortLevels: new Set(['low', 'medium', 'high']),
    });
    expect(claudeCodeTesting.parseClaudeCapabilities('none')).toMatchObject({
      permissionModes: new Set(),
      effortLevels: new Set(),
    });
    expect(claudeCodeTesting.optionalStringList({}, 'tools')).toBeUndefined();
    expect(
      claudeCodeTesting.optionalStringList({ tools: [] }, 'tools')
    ).toEqual([]);
    for (const value of ['x', [1], ['']]) {
      expect(() =>
        claudeCodeTesting.optionalStringList({ tools: value }, 'tools')
      ).toThrow();
    }
    expect(claudeCodeTesting.positiveNumber({}, 'turns', true)).toBeUndefined();
    expect(claudeCodeTesting.positiveNumber({ turns: 2 }, 'turns', true)).toBe(
      2
    );
    expect(
      claudeCodeTesting.positiveNumber({ budget: 0.5 }, 'budget', false)
    ).toBe(0.5);
    for (const value of ['1', Number.NaN, 0, 1.5]) {
      expect(() =>
        claudeCodeTesting.positiveNumber({ turns: value }, 'turns', true)
      ).toThrow();
    }
    expect(claudeCodeTesting.serializeClaudeValue('x')).toBe('x');
    expect(claudeCodeTesting.serializeClaudeValue(undefined)).toBe('');
    expect(claudeCodeTesting.serializeClaudeValue({ x: 1 })).toBe('{"x":1}');
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(claudeCodeTesting.serializeClaudeValue(circular)).toBe(
      '[object Object]'
    );
    expect(claudeCodeTesting.detectClaudeVersion('claude 1.2.3-beta')).toBe(
      '1.2.3-beta'
    );
    expect(claudeCodeTesting.detectClaudeVersion('none')).toBeUndefined();
    expect(claudeCodeTesting.isVersionBefore('1.2.3', '1.2.4')).toBe(true);
    expect(claudeCodeTesting.isVersionBefore('2.0.0', '1.9.9')).toBe(false);
    expect(claudeCodeTesting.isVersionBefore('1.2.3', '1.2.3')).toBe(false);
    expect(claudeCodeTesting.isVersionBefore('1', '1.0.1')).toBe(true);
    expect(claudeCodeTesting.isVersionBefore('1.1', '1')).toBe(false);
    expect(
      claudeCodeTesting.parseClaudeAuthentication(
        'not json\n{}\n{"loggedIn":true}'
      )
    ).toBe(true);
    expect(
      claudeCodeTesting.parseClaudeAuthentication(
        '{"authenticated":true}\n{"status":"authenticated"}'
      )
    ).toBe(true);
    expect(claudeCodeTesting.parseClaudeAuthentication('{bad')).toBe(false);
    expect(claudeCodeTesting.maxOutputBytes({})).toBeGreaterThan(0);
    expect(claudeCodeTesting.maxOutputBytes({ max_output_bytes: 1 })).toBe(1);
    for (const value of ['1', 0, 1.5]) {
      expect(() =>
        claudeCodeTesting.maxOutputBytes({ max_output_bytes: value })
      ).toThrow();
    }
    for (const [stderr, message] of [
      ['login required', 'authentication failed'],
      ['permission denied', 'denied'],
      ['max budget reached', 'budget'],
      ['other', undefined],
    ] as const) {
      expect(claudeCodeTesting.classifyClaudeError(stderr)).toEqual(
        message === undefined ? undefined : expect.stringContaining(message)
      );
    }
    expect(
      claudeCodeTesting.stderrPreview(
        processResult({ stderr: 'permission denied' })
      )
    ).toContain('denied');
    expect(claudeCodeTesting.stderrPreview(processResult())).toBe('');
    expect(
      claudeCodeTesting.redactSecretValues('abcd other', {
        API_KEY: 'abcd',
        SHORT_TOKEN: 'x',
        NORMAL: 'other',
      })
    ).toBe('[REDACTED] other');
    expect(
      claudeCodeTesting.redactHome(path.join(os.homedir(), 'x'))
    ).toContain('<home>');
    expect(claudeCodeTesting.redactHome(path.parse(root).root)).toBe(
      path.parse(root).root
    );

    const artifact = path.join(root, 'claude.jsonl');
    await fs.writeFile(
      artifact,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
      })}\n`
    );
    await expect(
      claudeCodeTesting.parseClaudeEventArtifact(artifact, 1024)
    ).resolves.toMatchObject({ terminal: { result: 'done' } });
  });

  test('covers Claude event helper fallbacks and retention boundaries', () => {
    expect(claudeEventTesting.isRecord({})).toBe(true);
    expect(claudeEventTesting.isRecord(null)).toBe(false);
    expect(claudeEventTesting.optionalString('x')).toBe('x');
    expect(claudeEventTesting.optionalString(1)).toBeUndefined();
    expect(claudeEventTesting.optionalNumber(1)).toBe(1);
    expect(claudeEventTesting.optionalNumber(Number.NaN)).toBeUndefined();
    expect(claudeEventTesting.optionalStringArray(['a', 1])).toEqual(['a']);
    expect(claudeEventTesting.optionalStringArray('a')).toEqual([]);
    expect(claudeEventTesting.contentBlocks([{ type: 'text' }, null])).toEqual([
      { type: 'text' },
    ]);
    expect(claudeEventTesting.contentBlocks('x')).toEqual([]);
    expect(claudeEventTesting.textFromContent('direct')).toEqual(['direct']);
    expect(
      claudeEventTesting.textFromContent([
        { type: 'text', text: 'a' },
        { type: 'other', text: 'b' },
      ])
    ).toEqual(['a']);
    expect(claudeEventTesting.textFromContent(1)).toEqual([]);
    expect(
      claudeEventTesting.usageFromRecord({
        inputTokens: 1,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        outputTokens: 4,
        costUSD: 5,
      })
    ).toMatchObject({ inputTokens: 1, outputTokens: 4, costUsd: 5 });
    expect(claudeEventTesting.usageFromRecord(null)).toEqual({
      source: 'unavailable',
    });
    const mergedUsage = { inputTokens: 1, totalTokens: 2 };
    claudeEventTesting.mergeUsage(
      mergedUsage,
      { outputTokens: 3, totalTokens: 4 },
      true
    );
    expect(mergedUsage).toMatchObject({ inputTokens: 1, outputTokens: 3 });
    expect(claudeEventTesting.calculateTotalTokens({})).toBeUndefined();
    expect(
      claudeEventTesting.calculateTotalTokens({
        inputTokens: 1,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        outputTokens: 4,
      })
    ).toBe(10);
    expect(claudeEventTesting.truncateUtf8('ok', 10)).toBe('ok');
    expect(Buffer.byteLength(claudeEventTesting.truncateUtf8('🙂', 3))).toBe(0);

    const parser = new ClaudeStreamParser({
      retainEvents: true,
      maxRetainedBytes: 1000,
    });
    parser.acceptLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'session',
        model: 'model',
      })
    );
    parser.acceptLine(JSON.stringify({ type: 'unknown' }));
    parser.acceptLine(JSON.stringify({}));
    expect(parser.finish().events.length).toBeGreaterThan(0);

    const tinyParser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 4,
    });
    tinyParser.acceptLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', input: undefined }] },
      })
    );
    expect(tinyParser.finish().retainedContentTruncated).toBe(true);
  });

  test('covers Codex helper validation, artifacts, and streaming redaction', async () => {
    expect(codexCliTesting.optionalString(undefined, 'x')).toBeUndefined();
    expect(codexCliTesting.optionalString('x', 'x')).toBe('x');
    for (const value of ['', 1]) {
      expect(() => codexCliTesting.optionalString(value, 'x')).toThrow();
    }
    expect(codexCliTesting.optionalBoolean(undefined, 'x', true)).toBe(true);
    expect(codexCliTesting.optionalBoolean(false, 'x', true)).toBe(false);
    expect(() => codexCliTesting.optionalBoolean('x', 'x', true)).toThrow();
    expect(codexCliTesting.maxOutputBytes({})).toBeGreaterThan(0);
    expect(codexCliTesting.maxOutputBytes({ output_limit_bytes: 1 })).toBe(1);
    for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        codexCliTesting.maxOutputBytes({ output_limit_bytes: value })
      ).toThrow();
    }
    expect(codexCliTesting.codexArtifactLimit(1)).toBeGreaterThan(1);
    expect(codexCliTesting.codexArtifactLimit(100_000_000)).toBeLessThanOrEqual(
      64 * 1024 * 1024
    );
    expect(codexCliTesting.detectCodexVersion('codex 1.2.3-alpha')).toBe(
      '1.2.3-alpha'
    );
    expect(codexCliTesting.detectCodexVersion('none')).toBeUndefined();
    for (const [stderr, expected] of [
      ['', ''],
      ['login 401', 'authentication'],
      ['model not found', 'model'],
      ['sandbox denied', 'sandbox'],
      ['other', 'inspect'],
    ] as const) {
      expect(
        codexCliTesting.stderrPreview(processResult({ stderr }))
      ).toContain(expected);
    }
    expect(
      codexCliTesting.credentialValues({
        API_KEY: 'abcdef',
        AUTHORIZATION: 'abcdefgh',
        SHORT_TOKEN: 'x',
        OTHER: 'abcdef',
      })
    ).toEqual(['abcdefgh', 'abcdef']);
    expect(codexCliTesting.redactSecrets('abcdef', { API_KEY: 'abcdef' })).toBe(
      '[REDACTED]'
    );
    expect(codexCliTesting.redactionVariants(['a"b', 'plain'])).toContain(
      'a\\"b'
    );
    const redactor = new codexCliTesting.StreamingSecretRedactor(['secret']);
    expect(redactor.push('before sec')).toBe('befor');
    expect(`${redactor.push('ret after')}${redactor.finish()}`).toContain(
      '[REDACTED]'
    );
    expect(new codexCliTesting.StreamingSecretRedactor([]).finish()).toBe('');

    expect(codexCliTesting.isWithin(root, root)).toBe(true);
    expect(codexCliTesting.isWithin(root, path.join(root, 'child'))).toBe(true);
    expect(codexCliTesting.isWithin(root, path.dirname(root))).toBe(false);
    expect(codexCliTesting.validatedChild(root, 'child')).toBe(
      path.join(root, 'child')
    );
    expect(() => codexCliTesting.validatedChild(root, '../escape')).toThrow();
    await expect(
      codexCliTesting.validatedDirectory('relative')
    ).rejects.toThrow();
    const artifacts = await codexCliTesting.validatedDirectory(
      path.join(root, 'artifacts')
    );
    await expect(
      codexCliTesting.validatedSubdirectory(artifacts, 'nested')
    ).resolves.toBe(path.join(artifacts, 'nested'));

    const prompt = path.join(root, 'prompt.md');
    await fs.writeFile(prompt, 'from file');
    await expect(
      codexCliTesting.loadPrompt(
        executionContext(root, { prompt_file: 'prompt.md' })
      )
    ).resolves.toBe('from file');
    await expect(
      codexCliTesting.loadPrompt(executionContext(root, { prompt: 'inline' }))
    ).resolves.toBe('inline');
    for (const config of [
      {},
      { prompt: 'x', prompt_file: 'prompt.md' },
      { prompt_file: '../escape' },
      { prompt_file: prompt },
    ]) {
      await expect(
        codexCliTesting.loadPrompt(executionContext(root, config))
      ).rejects.toThrow();
    }

    const file = path.join(root, 'artifact.log');
    await expect(
      codexCliTesting.sanitizeArtifact(file, 10, [])
    ).resolves.toBeUndefined();
    await fs.writeFile(file, 'secret and more content');
    await expect(
      codexCliTesting.sanitizeArtifact(file, 12, ['secret'])
    ).resolves.toMatchObject({ truncated: true, redactionCount: 1 });
    const direct = path.join(root, 'direct.log');
    await expect(
      codexCliTesting.writeSanitizedArtifact(direct, 'secret value', 100, [
        'secret',
      ])
    ).resolves.toMatchObject({ truncated: false, redactionCount: 1 });

    const eventFile = path.join(root, 'codex.jsonl');
    await fs.writeFile(
      eventFile,
      `${JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'done' },
      })}\n${JSON.stringify({ type: 'turn.completed' })}\n`
    );
    await expect(
      codexCliTesting.parseCodexArtifact(
        eventFile,
        '2026-01-01T00:00:00.000Z',
        1024,
        (value) => value
      )
    ).resolves.toMatchObject({ telemetry: { finalResponse: 'done' } });
    expect(codexCliTesting.packageVersion()).not.toBe('');
    expect(codexCliTesting.redactHome(path.join(os.homedir(), 'x'))).toContain(
      '<home>'
    );
  });

  test('covers Codex event summaries, malformed values, and budgets', () => {
    for (const [type, item] of [
      ['command_execution', {}],
      ['file_change', {}],
      ['mcp_tool_call', {}],
      ['web_search', {}],
      ['plan_update', {}],
      [undefined, {}],
    ] as const) {
      expect(codexEventTesting.itemSummary(type, item)).toEqual(
        expect.any(String)
      );
    }
    expect(codexEventTesting.errorMessage({ message: 'top' })).toBe('top');
    expect(
      codexEventTesting.errorMessage({ error: { message: 'nested' } })
    ).toBe('nested');
    expect(codexEventTesting.errorMessage({ error: 'raw' })).toBe('raw');
    expect(codexEventTesting.errorMessage({})).toContain('unspecified');
    expect(codexEventTesting.isObject({})).toBe(true);
    expect(codexEventTesting.isObject([])).toBe(false);
    expect(
      codexEventTesting.redactJsonValue(
        { text: 'secret', values: ['secret', 1] },
        (value) => value.replaceAll('secret', 'x')
      )
    ).toEqual({ text: 'x', values: ['x', 1] });
    expect(codexEventTesting.stringValue('x')).toBe('x');
    expect(codexEventTesting.stringValue(1)).toBeUndefined();
    expect(codexEventTesting.nonNegativeNumber(0)).toBe(0);
    expect(codexEventTesting.nonNegativeNumber(-1)).toBeUndefined();
    expect(
      codexEventTesting.validTimestamp('2026-01-01T00:00:00.000Z')
    ).toBeDefined();
    expect(codexEventTesting.validTimestamp('bad')).toBeUndefined();
    expect(codexEventTesting.safeJson({ x: 1 })).toBe('{"x":1}');
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(codexEventTesting.safeJson(circular)).toBe('{}');
    const budget = new codexEventTesting.RetentionBudget(5);
    expect(budget.reserve('a')).toBe(true);
    expect(budget.retain('b')).toBe('b');
    expect(budget.retainBounded('abcdef')).toEqual(expect.any(String));
    expect(budget.reserve('x')).toBe(false);

    const parser = new CodexEventParser();
    parser.pushLine(JSON.stringify({ type: 1 }));
    parser.pushLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'file_change', changes: [] },
      })
    );
    parser.pushLine(JSON.stringify({ type: 'turn.failed' }));
    expect(parser.finish().errors.length).toBeGreaterThan(0);
  });

  test('covers Copilot helper parsing, validation, and retention', async () => {
    expect(copilotCliTesting.detectCopilotVersion('Copilot CLI v1.2.3')).toBe(
      '1.2.3'
    );
    expect(copilotCliTesting.detectCopilotVersion('none')).toBeUndefined();
    expect(copilotCliTesting.requiredString('x', 'prompt')).toBe('x');
    expect(() =>
      copilotCliTesting.requiredString(undefined, 'prompt')
    ).toThrow();
    expect(copilotCliTesting.optionalString(undefined, 'x')).toBeUndefined();
    expect(() => copilotCliTesting.optionalString('', 'x')).toThrow();
    expect(
      copilotCliTesting.optionalNonNegativeInteger(undefined, 'x')
    ).toBeUndefined();
    expect(copilotCliTesting.optionalNonNegativeInteger(0, 'x')).toBe(0);
    expect(() =>
      copilotCliTesting.optionalNonNegativeInteger(-1, 'x')
    ).toThrow();
    expect(copilotCliTesting.optionalBoolean(undefined, 'x', false)).toBe(
      false
    );
    expect(copilotCliTesting.optionalBoolean(true, 'x', false)).toBe(true);
    expect(() => copilotCliTesting.optionalBoolean('x', 'x', false)).toThrow();
    expect(copilotCliTesting.maxOutputBytes({})).toBeGreaterThan(0);
    expect(copilotCliTesting.maxOutputBytes({ max_output_bytes: 1 })).toBe(1);
    expect(() =>
      copilotCliTesting.maxOutputBytes({ max_output_bytes: 0 })
    ).toThrow();
    for (const stderr of [
      '',
      'classic personal access token',
      'must be logged in',
      'bad credentials',
      'organization policy',
      'model unavailable',
      'other',
    ]) {
      expect(
        copilotCliTesting.stderrPreview(processResult({ stderr }))
      ).toEqual(expect.any(String));
    }
    expect(
      copilotCliTesting.redactSecretValues('abcdef', { TOKEN: 'abcdef' })
    ).toBe('[REDACTED]');
    expect(
      copilotCliTesting.redactHome(path.join(os.homedir(), 'x'))
    ).toContain('~');
    expect(copilotCliTesting.redactHome(path.parse(root).root)).toBe(
      path.parse(root).root
    );

    const artifact = path.join(root, 'copilot.jsonl');
    await fs.writeFile(
      artifact,
      `${JSON.stringify({
        type: 'assistant.message',
        data: { messageId: 'message', content: 'done' },
      })}\n${JSON.stringify({
        type: 'result',
        data: { exitCode: 0 },
      })}\n`
    );
    await expect(
      copilotCliTesting.parseCopilotEventArtifact(
        artifact,
        '2026-01-01T00:00:00.000Z',
        1024,
        false
      )
    ).resolves.toMatchObject({ telemetry: { finalResponse: 'done' } });

    expect(copilotEventTesting.truncateUtf8('ok', 10)).toBe('ok');
    expect(copilotEventTesting.truncateUtf8('🙂', 3)).toBe('');
    expect(copilotEventTesting.isObject({})).toBe(true);
    expect(copilotEventTesting.isObject(null)).toBe(false);
    expect(copilotEventTesting.stringValue('x')).toBe('x');
    expect(copilotEventTesting.stringValue(1)).toBeUndefined();
    expect(
      copilotEventTesting.isoTimestamp('2026-01-01T00:00:00.000Z')
    ).toBeDefined();
    expect(copilotEventTesting.isoTimestamp('bad')).toBeUndefined();
    expect(copilotEventTesting.numberValue(1)).toBe(1);
    expect(copilotEventTesting.numberValue(Number.NaN)).toBeUndefined();
    expect(copilotEventTesting.nonNegativeNumber(-1)).toBe(0);
    expect(copilotEventTesting.hasAnyNumber({ a: 1 }, ['a'])).toBe(true);
    expect(copilotEventTesting.firstNumber({ a: -1, b: 2 }, ['a', 'b'])).toBe(
      -1
    );
    expect(copilotEventTesting.explicitUsdValue({ cost_usd: 1 })).toBe(1);
    expect(copilotEventTesting.explicitUsdValue({ cost: 1 })).toBeUndefined();
    expect(copilotEventTesting.hashString('x')).toEqual(expect.any(Number));
    expect(copilotEventTesting.stringifyValue(undefined)).toBe('{}');
    expect(copilotEventTesting.stringifyValue(null)).toBe('null');
    expect(copilotEventTesting.stringifyValue('x')).toBe('x');
    expect(copilotEventTesting.stringifyValue({ x: 1 })).toBe('{"x":1}');
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(copilotEventTesting.stringifyValue(circular)).toBe(
      '[object Object]'
    );
    expect(
      copilotEventTesting.looksLikeTerminalEvent('{"type":"result"}')
    ).toBe(true);
    expect(copilotEventTesting.looksLikeTerminalEvent('text')).toBe(false);

    const textBudget = new copilotEventTesting.TextRetentionBudget(40);
    expect(textBudget.reserveEntry()).toBe(true);
    expect(textBudget.reserveEntry(0)).toBe(false);
    expect(textBudget.retain('long text')).toEqual(expect.any(String));
    const replaceable = new copilotEventTesting.ReplaceableTextRetention(2);
    expect(replaceable.replace('🙂')).toBe('');
    expect(replaceable.replace('x')).toBe('x');

    const parser = new CopilotEventParser();
    parser.pushLine(
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'm' } })
    );
    parser.pushLine(
      JSON.stringify({ type: 'session.tools_updated', data: { model: 'm2' } })
    );
    parser.pushLine(JSON.stringify({ type: 'error', error: { message: 'x' } }));
    parser.pushLine(
      JSON.stringify({
        type: 'assistant.message_delta',
        data: { deltaContent: 'nested', parentToolCallId: 'parent' },
      })
    );
    expect(parser.finish().errorEventCount).toBe(1);
  });

  test('covers adapter availability exception and failure paths', async () => {
    const executable: ResolvedExecutable = {
      path: path.join(root, 'cli'),
      kind: 'native',
    };
    const codex = new CodexCLIAdapter({
      resolveExecutable: async () => executable,
      runProcess: async () => {
        throw new Error('probe');
      },
    });
    await expect(codex.diagnoseAvailability({})).resolves.toMatchObject({
      installed: true,
      authenticated: 'unknown',
    });

    const copilot = new CopilotCLIAdapter({
      resolveExecutable: async () => executable,
      runProcess: async () => {
        throw new Error('probe');
      },
    });
    await expect(copilot.checkAvailability()).resolves.toBe(false);

    const claude = new ClaudeCodeAdapter({
      resolveExecutable: async () => undefined,
    });
    await expect(claude.checkAvailability()).resolves.toBe(false);
  });
});
