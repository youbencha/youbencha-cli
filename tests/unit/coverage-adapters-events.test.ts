import { ClaudeStreamParser } from '../../src/adapters/claude-code-events.js';
import {
  CodexEventParser,
  parseCodexEventStream,
} from '../../src/adapters/codex-cli-events.js';
import {
  classifyCopilotError,
  parseCopilotEventStream,
  stripAnsiOutsideJson,
} from '../../src/adapters/copilot-cli-events.js';

function jsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n');
}

describe('adapter event parser coverage edges', () => {
  test('Claude parser handles alternate shapes and bounded malformed data', () => {
    expect(
      () =>
        new ClaudeStreamParser({
          retainEvents: false,
          maxRetainedBytes: -1,
        })
    ).toThrow(/non-negative integer/);
    expect(
      () =>
        new ClaudeStreamParser({
          retainEvents: false,
          maxRetainedBytes: 1.5,
        })
    ).toThrow(/non-negative integer/);

    const parser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 180,
    });
    parser.acceptLine('');
    parser.acceptLine('1');
    parser.acceptLine(jsonl([{ type: 'assistant' }]));
    parser.acceptLine(jsonl([{ type: 'user' }]));
    parser.acceptLine(
      jsonl([
        {
          type: 'assistant',
          message: {
            model: 'alternate-model',
            content: 'direct text',
            usage: {
              inputTokens: 1,
              cacheCreationInputTokens: 2,
              cacheReadInputTokens: 3,
              outputTokens: 4,
              costUSD: 0.5,
            },
          },
        },
      ])
    );
    parser.acceptLine(
      jsonl([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool',
                name: 'Read',
              },
            ],
          },
        },
      ])
    );
    parser.acceptLine(
      jsonl([
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool',
                content: { nested: true },
                is_error: 'not-boolean',
              },
            ],
          },
        },
      ])
    );
    parser.acceptLine(
      jsonl([
        {
          type: 'system',
          subtype: 'retry',
          delay_ms: 25,
          error_message: 'retry',
        },
      ])
    );
    parser.acceptLine(jsonl([{ type: 'error', message: 'top-level' }]));
    parser.acceptLine(jsonl([{ type: 'error', error: 'string error' }]));
    parser.acceptLine(jsonl([{ type: 'error' }]));
    parser.acceptLine(
      jsonl([
        {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
        },
      ])
    );
    const result = parser.finish();
    expect(result.malformedTerminal).toBe(false);
    expect(result.errorEventCount).toBe(3);
    expect(result.retainedContentBytes).toBeLessThanOrEqual(180);

    const unicode = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 10,
    });
    unicode.acceptLine(
      jsonl([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '🙂🙂🙂',
        },
      ])
    );
    expect(unicode.finish().retainedContentTruncated).toBe(true);
  });

  test('Codex parser diagnoses invalid options, records, items, and errors', () => {
    for (const maxRetainedBytes of [0, -1, 1.5]) {
      expect(() => new CodexEventParser({ maxRetainedBytes })).toThrow(
        /positive integer/
      );
    }
    for (const maxPartialLineBytes of [0, -1, 1.5]) {
      expect(() => new CodexEventParser({ maxPartialLineBytes })).toThrow(
        /positive integer/
      );
    }

    const parser = new CodexEventParser({
      defaultTimestamp: 'invalid',
      maxRetainedBytes: 4096,
    });
    parser.pushLine('');
    parser.pushLine('not-json');
    parser.pushLine('[]');
    parser.pushLine('{}');
    parser.pushLine(
      jsonl([{ type: 'item.started', item: { type: 'reasoning' } }])
    );
    parser.pushLine(
      jsonl([{ type: 'item.updated', item: { type: 'reasoning' } }])
    );
    parser.pushLine(
      jsonl([
        {
          type: 'item.completed',
          item: { type: 'agent_message', content: 'content response' },
        },
      ])
    );
    parser.pushLine(
      jsonl([
        {
          type: 'item.completed',
          item: { type: 'agent_message', message: 'message response' },
        },
      ])
    );
    parser.pushLine(
      jsonl([{ type: 'item.completed', item: { type: 'reasoning' } }])
    );
    parser.pushLine(
      jsonl([{ type: 'item.completed', item: { type: 'unknown-item' } }])
    );
    for (const item of [
      { type: 'command_execution' },
      { type: 'file_change', status: 'completed' },
      { type: 'mcp_tool_call' },
      { type: 'web_search' },
      { type: 'plan_update' },
    ]) {
      parser.pushLine(jsonl([{ type: 'item.completed', item }]));
    }
    parser.pushLine(jsonl([{ type: 'turn.completed', usage: 'invalid' }]));
    parser.pushLine(jsonl([{ type: 'error', message: 'message error' }]));
    parser.pushLine(
      jsonl([{ type: 'error', error: { message: 'nested error' } }])
    );
    parser.pushLine(jsonl([{ type: 'error', error: 'string error' }]));
    parser.pushLine(jsonl([{ type: 'turn.failed' }]));
    const result = parser.finish();
    expect(result.malformedLineCount).toBe(3);
    expect(result.errors).toHaveLength(5);
  });

  test('Codex parser covers partial lines, bounded messages, and usage aliases', () => {
    const parser = new CodexEventParser({
      defaultTimestamp: '2026-01-01T00:00:00.000Z',
      maxRetainedBytes: 128,
      maxPartialLineBytes: 64,
    });
    parser.pushChunk('');
    parser.pushChunk('x'.repeat(100));
    parser.pushChunk('\n');
    parser.pushLine(
      jsonl([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: '🙂'.repeat(100),
          },
        },
      ])
    );
    parser.pushLine(
      jsonl([
        {
          type: 'turn.completed',
          usage: {
            inputTokens: 2,
            cachedInputTokens: 1,
            outputTokens: 3,
            reasoningOutputTokens: 4,
          },
        },
      ])
    );
    expect(parser.finish().contentTruncated).toBe(true);

    expect(
      parseCodexEventStream(
        jsonl([
          {
            type: 'item.completed',
            item: { type: 'agent_message', text: 'ok' },
          },
          { type: 'turn.completed' },
        ])
      ).telemetry.finalResponse
    ).toBe('ok');
  });

  test('Copilot parser handles validation, malformed event shapes, and fallbacks', () => {
    expect(() => parseCopilotEventStream('', { maxRetainedBytes: -1 })).toThrow(
      /positive integer/
    );
    expect(() =>
      parseCopilotEventStream('', { maxRetainedBytes: 1.5 })
    ).toThrow(/positive integer/);

    const events = [
      '1',
      '{}',
      jsonl([{ type: 'session.start', data: 'invalid' }]),
      jsonl([{ type: 'session.start', data: {} }]),
      jsonl([{ type: 'assistant.message', data: {} }]),
      jsonl([
        {
          type: 'assistant.message',
          timestamp: 'invalid',
          data: {
            content: 'response',
            toolRequests: [
              null,
              {},
              { toolCallId: 'tool', name: 'Read', arguments: 'text' },
            ],
          },
        },
      ]),
      jsonl([{ type: 'assistant.message_delta', data: {} }]),
      jsonl([{ type: 'tool.execution_start', data: {} }]),
      jsonl([
        {
          type: 'tool.execution_start',
          data: { toolCallId: 'tool', toolName: 'Read' },
        },
      ]),
      jsonl([
        {
          type: 'tool.execution_start',
          data: { toolCallId: 'tool', toolName: 'Read' },
        },
      ]),
      jsonl([{ type: 'tool.execution_complete', data: {} }]),
      jsonl([
        {
          type: 'tool.execution_complete',
          data: { toolCallId: 'tool', success: false },
        },
      ]),
      jsonl([{ type: 'session.error', data: {} }]),
      jsonl([
        {
          type: 'session.shutdown',
          data: {
            modelMetrics: {
              invalid: 'value',
              valid: {
                usage: {
                  inputTokens: -1,
                  cacheReadTokens: -1,
                  outputTokens: -1,
                },
                requests: { cost: -1, cost_usd: -1 },
              },
            },
          },
        },
      ]),
      jsonl([
        {
          type: 'result',
          data: {
            sessionId: 'nested-session',
            model: 'nested-model',
            exitCode: 2,
            usage: {
              promptTokens: -1,
              cachedPromptTokens: -2,
              completionTokens: -3,
              usdCost: -4,
              aiCredits: -5,
            },
          },
        },
      ]),
    ];
    const parsed = parseCopilotEventStream(events.join('\n'), {
      defaultTimestamp: 'invalid',
      maxRetainedBytes: 4096,
    });
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.errorEventCount).toBeGreaterThan(0);
    expect(parsed.telemetry.usage.source).toBe('measured');
  });

  test('Copilot error classification and ANSI stripping cover alternate paths', () => {
    for (const [message, errorType, status, expected] of [
      ['classic pat', undefined, undefined, 'classic-pat-unsupported'],
      ['no credentials', undefined, undefined, 'credentials-missing'],
      ['expired', undefined, undefined, 'credentials-expired-or-insufficient'],
      ['policy denied', undefined, undefined, 'organization-policy-denied'],
      ['entitlement', undefined, undefined, 'model-or-entitlement-denied'],
      ['unclassified', undefined, undefined, 'unknown'],
    ] as const) {
      expect(classifyCopilotError(message, errorType, status)).toBe(expected);
    }

    expect(stripAnsiOutsideJson('\u001b]title\u0007{}')).toBe('{}');
    expect(stripAnsiOutsideJson('\u001b]title\u001b\\{}')).toBe('{}');
    expect(stripAnsiOutsideJson('{"value":"quote: \\" and slash \\\\"}')).toBe(
      '{"value":"quote: \\" and slash \\\\"}'
    );
  });
});
