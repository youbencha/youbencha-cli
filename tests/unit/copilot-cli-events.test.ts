import {
  classifyCopilotError,
  parseCopilotEventStream,
  stripAnsiOutsideJson,
} from '../../src/adapters/copilot-cli-events.js';

const timestamp = '2026-07-25T12:00:00.000Z';

function event(type: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `${type}-id`,
    timestamp,
    parentId: null,
    type,
    data,
  });
}

describe('Copilot JSONL event parser', () => {
  it('extracts the final response, session, model, measured usage, and tools', () => {
    const rawOutput = [
      event('session.start', {
        sessionId: 'session-123',
        copilotVersion: '1.0.75',
        selectedModel: 'gpt-5.4',
      }),
      event('assistant.message', {
        messageId: 'message-1',
        content: 'I will inspect the file.',
        toolRequests: [
          {
            toolCallId: 'tool-1',
            name: 'read_file',
            arguments: { path: 'src/index.ts' },
          },
        ],
      }),
      event('tool.execution_start', {
        toolCallId: 'tool-1',
        toolName: 'read_file',
        arguments: { path: 'src/index.ts' },
      }),
      event('tool.execution_complete', {
        toolCallId: 'tool-1',
        success: true,
        result: { content: 'file contents' },
      }),
      event('assistant.usage', {
        model: 'gpt-5.4',
        inputTokens: 5,
        cacheReadTokens: 2,
        outputTokens: 3,
        cost: 0.01,
      }),
      event('future.event', { futureField: true }),
      event('assistant.message', {
        messageId: 'message-2',
        content: 'Implemented the requested change.',
      }),
      event('session.shutdown', {
        shutdownType: 'routine',
        totalPremiumRequests: 2,
        currentModel: 'gpt-5.4',
        modelMetrics: {
          'gpt-5.4': {
            requests: { count: 2, cost: 0.25 },
            usage: {
              inputTokens: 100,
              outputTokens: 40,
              cacheReadTokens: 30,
              cacheWriteTokens: 5,
            },
          },
        },
      }),
    ].join('\n');

    const parsed = parseCopilotEventStream(rawOutput, {
      defaultTimestamp: timestamp,
    });

    expect(parsed.structured).toBe(true);
    expect(parsed.terminalEventSeen).toBe(true);
    expect(parsed.telemetry).toMatchObject({
      cliVersion: '1.0.75',
      model: 'gpt-5.4',
      sessionId: 'session-123',
      finalResponse: 'Implemented the requested change.',
      structuredOutputFormat: 'jsonl',
      legacyParserUsed: false,
      usage: {
        promptTokens: 100,
        cachedPromptTokens: 30,
        completionTokens: 40,
        totalTokens: 140,
        credits: 2,
        source: 'measured',
      },
    });
    expect(parsed.telemetry.usage).not.toHaveProperty('costUsd');
    expect(parsed.unknownEventTypes).toEqual(['future.event']);

    const toolCalls = parsed.telemetry.messages?.flatMap(
      (message) => message.tool_calls ?? []
    );
    expect(toolCalls).toEqual([
      {
        id: 'tool-1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"src/index.ts"}',
        },
      },
    ]);
    expect(
      parsed.telemetry.messages?.find((message) => message.role === 'tool')
    ).toMatchObject({
      content: 'file contents',
      tool_call_id: 'tool-1',
    });
  });

  it('assembles delta-only assistant responses', () => {
    const parsed = parseCopilotEventStream(
      [
        event('assistant.message_delta', {
          messageId: 'message-1',
          deltaContent: 'Hello ',
        }),
        event('assistant.message_delta', {
          messageId: 'message-1',
          deltaContent: 'world',
        }),
        event('session.idle'),
      ].join('\n'),
      { defaultTimestamp: timestamp }
    );

    expect(parsed.telemetry.finalResponse).toBe('Hello world');
    expect(parsed.telemetry.messages).toContainEqual({
      role: 'assistant',
      content: 'Hello world',
      timestamp,
    });
  });

  it('parses Copilot prompt-mode result records and tools-updated model data', () => {
    const parsed = parseCopilotEventStream(
      [
        event('session.tools_updated', { model: 'claude-sonnet-4.6' }),
        event('assistant.message', {
          messageId: 'message-1',
          content: 'Prompt-mode response',
          outputTokens: 8,
        }),
        JSON.stringify({
          type: 'result',
          sessionId: 'prompt-session-1',
          exitCode: 0,
          usage: {
            premiumRequests: 1,
            totalApiDurationMs: 100,
            sessionDurationMs: 200,
            codeChanges: {
              linesAdded: 2,
              linesRemoved: 1,
              filesModified: ['src/index.ts'],
            },
          },
        }),
      ].join('\n'),
      { defaultTimestamp: timestamp }
    );

    expect(parsed.terminalEventSeen).toBe(true);
    expect(parsed.telemetry).toMatchObject({
      sessionId: 'prompt-session-1',
      model: 'claude-sonnet-4.6',
      finalResponse: 'Prompt-mode response',
      usage: {
        completionTokens: 8,
        credits: 1,
        source: 'measured',
      },
    });
    expect(parsed.telemetry.usage).not.toHaveProperty('promptTokens');
    expect(parsed.telemetry.usage).not.toHaveProperty('totalTokens');
  });

  it('accepts unknown events and diagnoses malformed non-terminal lines', () => {
    const parsed = parseCopilotEventStream(
      [
        event('future.event', { value: 1 }),
        '{"type":"assistant.message",not-json}',
        event('assistant.message', {
          messageId: 'message-1',
          content: 'Done',
        }),
        event('session.idle'),
      ].join('\n'),
      { defaultTimestamp: timestamp }
    );

    expect(parsed.telemetry.finalResponse).toBe('Done');
    expect(parsed.unknownEventTypes).toEqual(['future.event']);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics.join(' ')).not.toContain('assistant.message');
    expect(parsed.malformedTerminalEvent).toBe(false);
  });

  it('marks malformed terminal events as fatal parser state', () => {
    const parsed = parseCopilotEventStream(
      [
        event('assistant.message', {
          messageId: 'message-1',
          content: 'Done',
        }),
        '{"type":"session.shutdown","data":',
      ].join('\n'),
      { defaultTimestamp: timestamp }
    );

    expect(parsed.malformedTerminalEvent).toBe(true);
    expect(parsed.terminalEventSeen).toBe(false);
  });

  it('rejects plain text by default', () => {
    const parsed = parseCopilotEventStream('Older Copilot response\n', {
      defaultTimestamp: timestamp,
    });

    expect(parsed.structured).toBe(false);
    expect(parsed.telemetry).toMatchObject({
      legacyParserUsed: false,
      usage: { source: 'unavailable' },
    });
    expect(parsed.telemetry.finalResponse).toBeUndefined();
    expect(parsed.telemetry.messages).toEqual([]);
  });

  it('uses plain-text fallback only through explicit legacy compatibility', () => {
    const parsed = parseCopilotEventStream('Older Copilot response\n', {
      defaultTimestamp: timestamp,
      allowLegacyText: true,
    });

    expect(parsed.structured).toBe(false);
    expect(parsed.telemetry).toMatchObject({
      finalResponse: 'Older Copilot response',
      legacyParserUsed: true,
      structuredOutputFormat: 'text',
      usage: { source: 'unavailable' },
    });
    expect(parsed.telemetry.messages).toEqual([
      {
        role: 'assistant',
        content: 'Older Copilot response',
        timestamp,
      },
    ]);
  });

  it('treats generic cost as credits and only explicit USD fields as dollars', () => {
    const parsed = parseCopilotEventStream(
      [
        event('assistant.usage', {
          model: 'gpt-5.4',
          inputTokens: 10,
          outputTokens: 4,
          cost: 1.5,
        }),
        event('assistant.usage', {
          model: 'gpt-5.4',
          costUsd: 0.02,
        }),
        event('assistant.message', {
          messageId: 'message-1',
          content: 'Done',
        }),
        event('session.idle'),
      ].join('\n'),
      { defaultTimestamp: timestamp }
    );

    expect(parsed.telemetry.usage).toMatchObject({
      credits: 1.5,
      costUsd: 0.02,
      source: 'measured',
    });
  });

  it('bounds retained content while continuing terminal and usage parsing', () => {
    const hugeToolOutput = 'x'.repeat(20_000);
    const rawOutput = [
      event('tool.execution_start', {
        toolCallId: 'tool-1',
        toolName: 'read_file',
        arguments: { path: 'large.txt' },
      }),
      event('tool.execution_complete', {
        toolCallId: 'tool-1',
        success: true,
        result: { content: hugeToolOutput },
      }),
      event('assistant.message', {
        messageId: 'message-1',
        content: 'Final response',
      }),
      event('assistant.usage', {
        model: 'gpt-5.4',
        inputTokens: 100,
        outputTokens: 20,
      }),
      JSON.stringify({
        type: 'result',
        sessionId: 'bounded-session',
        exitCode: 0,
        usage: { premiumRequests: 2 },
      }),
    ].join('\n');

    const parsed = parseCopilotEventStream(rawOutput, {
      defaultTimestamp: timestamp,
      maxRetainedBytes: 128,
    });

    expect(parsed.contentTruncated).toBe(true);
    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(128);
    expect(parsed.terminalEventSeen).toBe(true);
    expect(parsed.telemetry.finalResponse).toBe('Final response');
    expect(parsed.telemetry.usage).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      credits: 2,
      source: 'measured',
    });
    expect(parsed.telemetry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('retained content was truncated'),
      ])
    );
  });

  it('bounds structural entries across repeated tiny errors and events', () => {
    const repeatedEvents = Array.from({ length: 1_000 }, (_, index) => [
      event('session.error', { message: 'x' }),
      JSON.stringify({ type: 'result', exitCode: 1 }),
      event(`future.${index}`),
      event('assistant.message', {
        messageId: `message-${index}`,
        content: 'x',
      }),
      event('tool.execution_start', {
        toolCallId: `tool-${index}`,
        toolName: 'x',
      }),
      'not-json',
    ]).flat();
    repeatedEvents.push(
      JSON.stringify({
        type: 'result',
        exitCode: 0,
        usage: { premiumRequests: 4 },
      })
    );

    const parsed = parseCopilotEventStream(repeatedEvents.join('\n'), {
      defaultTimestamp: timestamp,
      maxRetainedBytes: 512,
    });

    const retainedArrayEntries =
      parsed.errors.length +
      parsed.unknownEventTypes.length +
      parsed.diagnostics.length +
      (parsed.telemetry.messages?.length ?? 0);
    expect(retainedArrayEntries).toBeLessThanOrEqual(8);
    expect(parsed.errors.length).toBeLessThanOrEqual(8);
    expect(parsed.errorEventCount).toBe(2_000);
    expect(parsed.contentTruncated).toBe(true);
    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(512);
    expect(parsed.terminalEventSeen).toBe(true);
    expect(parsed.telemetry.usage).toMatchObject({
      credits: 4,
      source: 'measured',
    });
  });

  it('removes ANSI wrappers without changing control bytes in JSON strings', () => {
    const wrapped = `\u001b[32m${event('session.idle')}\u001b[0m`;
    expect(JSON.parse(stripAnsiOutsideJson(wrapped))).toMatchObject({
      type: 'session.idle',
    });

    const insideString = '{"content":"\u001b[31mred"}';
    expect(stripAnsiOutsideJson(insideString)).toBe(insideString);
  });

  it.each([
    [
      'Classic personal access tokens are unsupported',
      undefined,
      undefined,
      'classic-pat-unsupported',
    ],
    [
      'You must be logged in',
      'authentication',
      undefined,
      'credentials-missing',
    ],
    ['Bad credentials', undefined, 401, 'credentials-expired-or-insufficient'],
    [
      'Blocked by your organization',
      undefined,
      403,
      'organization-policy-denied',
    ],
    [
      'The selected model is not available',
      undefined,
      403,
      'model-or-entitlement-denied',
    ],
  ])(
    'classifies structured errors: %s',
    (message, errorType, statusCode, expected) => {
      expect(classifyCopilotError(message, errorType, statusCode)).toBe(
        expected
      );
    }
  );
});
