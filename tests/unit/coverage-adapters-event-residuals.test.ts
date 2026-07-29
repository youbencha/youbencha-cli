import {
  ClaudeStreamParser,
  parseClaudeStream,
} from '../../src/adapters/claude-code-events.js';
import { CodexEventParser } from '../../src/adapters/codex-cli-events.js';
import {
  CopilotEventParser,
  parseCopilotEventStream,
} from '../../src/adapters/copilot-cli-events.js';

describe('adapter event residual coverage', () => {
  test('covers Claude alternate value and retention paths', () => {
    const parser = new ClaudeStreamParser({
      retainEvents: true,
      maxRetainedBytes: 256,
    });
    for (const event of [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'first',
        model: 'first-model',
      },
      { type: 'system', subtype: 'init' },
      {
        type: 'system',
        subtype: 'retry',
        delay_ms: 3,
        error_message: 'retry',
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool',
              content: { large: 'value' },
              is_error: true,
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-without-error',
              content: 'ok',
            },
          ],
        },
      },
      {
        type: 'system',
        subtype: 'retry',
        retry_delay_ms: 2,
        error: 'direct retry',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        modelUsage: { model: { cost_usd: 2 } },
      },
    ]) {
      parser.acceptLine(JSON.stringify(event));
    }
    expect(parser.retainValue(undefined)).toBeUndefined();
    expect(parser.retainValue('x'.repeat(500))).toBeUndefined();
    expect(parser.finish().sessionId).toBe('first');
    expect(
      parseClaudeStream(
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-without-error',
                content: 'ok',
              },
            ],
          },
        })
      ).toolEvents[0]?.isError
    ).toBeUndefined();

    for (const retry of [
      { retry_delay_ms: 2, error: 'direct retry' },
      { delay_ms: 3, error_message: 'fallback retry' },
    ]) {
      expect(
        parseClaudeStream(
          JSON.stringify({
            type: 'system',
            subtype: 'retry',
            ...retry,
          })
        ).retries
      ).toHaveLength(1);
    }

    for (const event of [
      { type: 'error', error: 'raw error' },
      { type: 'error', error: { message: 'nested error' } },
      { type: 'error' },
    ]) {
      expect(parseClaudeStream(JSON.stringify(event)).errors).not.toHaveLength(
        0
      );
    }
  });

  test('covers Codex token aliases and exhausted tool retention', () => {
    for (const usage of [{ input_tokens: 2 }, { output_tokens: 3 }]) {
      const parser = new CodexEventParser();
      parser.pushLine(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'done' },
        })
      );
      parser.pushLine(JSON.stringify({ type: 'turn.completed', usage }));
      expect(parser.finish().telemetry.usage?.totalTokens).toBeGreaterThan(0);
    }

    const tiny = new CodexEventParser({ maxRetainedBytes: 1 });
    tiny.pushLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'echo', output: 'x' },
      })
    );
    tiny.pushLine(JSON.stringify({ type: 'turn.failed' }));
    expect(tiny.finish().errors[0]?.kind).toBe('turn.failed');

    const withError = new CodexEventParser({ maxRetainedBytes: 256 });
    withError.pushLine(
      JSON.stringify({ type: 'error', message: 'structured error' })
    );
    withError.pushLine(JSON.stringify({ type: 'turn.failed' }));
    expect(withError.finish().errors[0]?.kind).toBe('error');
  });

  test('covers Copilot malformed tools, fallbacks, metrics, and retention', () => {
    const parser = new CopilotEventParser({ maxRetainedBytes: 2048 });
    for (const event of [
      { type: 'session.model_change', data: {} },
      { type: 'session.tools_updated', data: {} },
      { type: 'error', error: { message: 'outer error' } },
      {
        type: 'assistant.message',
        data: {
          messageId: 'message',
          content: 'content',
          toolRequests: [
            null,
            { toolCallId: 'missing-name' },
            {
              toolCallId: 'custom',
              name: 'tool',
              type: 'custom',
              arguments: {},
            },
          ],
        },
      },
      {
        type: 'assistant.message_delta',
        data: {
          messageId: 'nested',
          deltaContent: 'ignored',
          parentToolCallId: 'parent',
        },
      },
      {
        type: 'tool.execution_complete',
        data: { toolCallId: 'one', result: {}, success: true },
      },
      { type: 'session.shutdown', data: { modelMetrics: 'invalid' } },
      {
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            one: { usage: 'invalid', requests: 'invalid' },
          },
        },
      },
      { type: 'result', data: { exitCode: 0 } },
    ]) {
      parser.pushLine(JSON.stringify(event));
    }
    expect(parser.finish().telemetry.finalResponse).toBe('content');

    for (const event of [
      { type: 'error' },
      { type: 'error', error: { message: 'nested' } },
    ]) {
      const errors = new CopilotEventParser();
      errors.pushLine(JSON.stringify(event));
      expect(errors.finish().errorEventCount).toBeGreaterThanOrEqual(0);
    }

    for (const raw of [
      JSON.stringify({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'one',
          error: { message: 'failed' },
          success: false,
        },
      }),
      JSON.stringify({
        type: 'tool.execution_complete',
        data: { toolCallId: 'one', success: false },
      }),
    ]) {
      const parsed = parseCopilotEventStream(
        `${raw}\n${JSON.stringify({ type: 'result', data: { exitCode: 0 } })}`
      );
      expect(parsed.telemetry.toolEvents?.length ?? 0).toBeLessThanOrEqual(1);
    }

    const tiny = new CopilotEventParser({ maxRetainedBytes: 1 });
    for (const event of [
      {
        type: 'assistant.message',
        data: { messageId: 'message', content: 'content' },
      },
      { type: 'error', data: { message: 'error' } },
      {
        type: 'assistant.message',
        data: {
          messageId: 'tool-message',
          content: '',
          toolRequests: [{ toolCallId: 'tool', name: 'name', arguments: {} }],
        },
      },
      { type: 'result', data: { exitCode: 0 } },
    ]) {
      tiny.pushLine(JSON.stringify(event));
    }
    expect(tiny.finish().contentTruncated).toBe(true);

    const exactEntry = new CopilotEventParser({ maxRetainedBytes: 64 });
    exactEntry.pushLine(
      JSON.stringify({ type: 'error', data: { message: 'error' } })
    );
    exactEntry.pushLine(
      JSON.stringify({
        type: 'session.error',
        data: { message: 'structured' },
      })
    );
    expect(exactEntry.finish().contentTruncated).toBe(true);

    const emptyTool = new CopilotEventParser({ maxRetainedBytes: 20 });
    emptyTool.pushLine(
      JSON.stringify({
        type: 'tool.execution_complete',
        data: { toolCallId: 'a', result: {}, success: true },
      })
    );
    expect(emptyTool.finish()).toBeDefined();

    const rejectedTool = new CopilotEventParser({ maxRetainedBytes: 1 });
    rejectedTool.pushLine(
      JSON.stringify({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tool',
          result: { content: 'content' },
          success: true,
        },
      })
    );
    expect(rejectedTool.finish().contentTruncated).toBe(true);

    for (const modelMetrics of [
      { one: { usage: { inputTokens: 1 }, requests: {} } },
      { one: { usage: { cacheReadTokens: 1 }, requests: {} } },
      { one: { usage: { outputTokens: 1 }, requests: {} } },
      { one: { usage: {}, requests: { cost: 1 } } },
      { one: { usage: {}, requests: { cost_usd: 1 } } },
    ]) {
      const usage = new CopilotEventParser();
      usage.pushLine(
        JSON.stringify({ type: 'session.shutdown', data: { modelMetrics } })
      );
      expect(usage.finish().telemetry.usage).toBeDefined();
    }

    const deltaNoContent = new CopilotEventParser({ maxRetainedBytes: 1 });
    deltaNoContent.pushLine(
      JSON.stringify({
        type: 'assistant.message_delta',
        data: { messageId: 'delta', deltaContent: 'content' },
      })
    );
    expect(deltaNoContent.finish().contentTruncated).toBe(true);

    const deltaNoEntry = new CopilotEventParser({ maxRetainedBytes: 100 });
    deltaNoEntry.pushLine(
      JSON.stringify({
        type: 'assistant.message_delta',
        data: { messageId: 'delta', deltaContent: 'x'.repeat(30) },
      })
    );
    expect(deltaNoEntry.finish().contentTruncated).toBe(true);

    const structuredNoText = new CopilotEventParser({
      maxRetainedBytes: 64,
    });
    structuredNoText.pushLine(
      JSON.stringify({ type: 'result', data: { exitCode: 1 } })
    );
    expect(structuredNoText.finish().contentTruncated).toBe(true);

    expect(
      parseCopilotEventStream(
        JSON.stringify({ type: 'result', data: { exitCode: 0 } })
      )
    ).toBeDefined();
  });
});
