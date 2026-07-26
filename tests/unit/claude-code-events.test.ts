import {
  ClaudeStreamParser,
  parseClaudeStream,
} from '../../src/adapters/claude-code-events.js';

function jsonl(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('parseClaudeStream', () => {
  it('extracts initialization, messages, tools, retries, terminal usage, and cost', () => {
    const raw = jsonl([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'session-123',
        model: 'claude-sonnet-4-5',
        claude_code_version: '2.1.212',
        permissionMode: 'dontAsk',
        tools: ['Read', 'Edit'],
        agents: ['reviewer'],
        skills: ['typescript'],
      },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          content: [
            { type: 'text', text: 'Working' },
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Read',
              input: { file_path: 'src/index.ts' },
            },
          ],
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 1,
            output_tokens: 3,
          },
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'file contents',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 500,
        error: 'rate limited',
      },
      { type: 'future_event', payload: true },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Finished successfully',
        session_id: 'session-123',
        total_cost_usd: 0.0123,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 1,
          output_tokens: 3,
        },
      },
    ]);

    const parsed = parseClaudeStream(raw);

    expect(parsed.init).toEqual({
      sessionId: 'session-123',
      model: 'claude-sonnet-4-5',
      claudeCodeVersion: '2.1.212',
      permissionMode: 'dontAsk',
      tools: ['Read', 'Edit'],
      agents: ['reviewer'],
      skills: ['typescript'],
    });
    expect(parsed.finalResponse).toBe('Finished successfully');
    expect(parsed.sessionId).toBe('session-123');
    expect(parsed.model).toBe('claude-sonnet-4-5');
    expect(parsed.toolEvents).toEqual([
      {
        kind: 'tool_use',
        id: 'tool-1',
        name: 'Read',
        input: { file_path: 'src/index.ts' },
      },
      {
        kind: 'tool_result',
        id: 'tool-1',
        content: 'file contents',
        isError: false,
      },
    ]);
    expect(parsed.retries).toEqual([
      {
        attempt: 2,
        maxRetries: 5,
        delayMs: 500,
        error: 'rate limited',
      },
    ]);
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 1,
      outputTokens: 3,
      totalTokens: 16,
      costUsd: 0.0123,
      source: 'measured',
    });
    expect(parsed.unknownEventTypes).toEqual(['future_event']);
    expect(parsed.events).toHaveLength(6);
  });

  it('classifies an error terminal event', () => {
    const parsed = parseClaudeStream(
      jsonl([
        {
          type: 'result',
          subtype: 'error_max_budget_usd',
          is_error: true,
          result: 'Maximum budget exceeded',
          session_id: 'budget-session',
        },
      ])
    );

    expect(parsed.terminal).toEqual({
      subtype: 'error_max_budget_usd',
      isError: true,
      result: 'Maximum budget exceeded',
    });
    expect(parsed.errors).toEqual(['Maximum budget exceeded']);
    expect(parsed.usage.source).toBe('unavailable');
  });

  it('accepts modelUsage metrics and structured error events', () => {
    const parsed = parseClaudeStream(
      jsonl([
        {
          type: 'error',
          error: { type: 'api_error', message: 'temporary provider failure' },
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'recovered',
          modelUsage: {
            'claude-sonnet-4-5': {
              inputTokens: 7,
              cacheReadInputTokens: 5,
              outputTokens: 2,
              costUSD: 0.004,
            },
          },
        },
      ])
    );

    expect(parsed.errors).toContain('temporary provider failure');
    expect(parsed.errorEventCount).toBe(1);
    expect(parsed.usage).toEqual({
      inputTokens: 7,
      cacheReadInputTokens: 5,
      outputTokens: 2,
      totalTokens: 14,
      costUsd: 0.004,
      source: 'measured',
    });
  });

  it('retains the last assistant message but rejects a success result without result text', () => {
    const parsed = parseClaudeStream(
      jsonl([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First response' }],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Final response' }],
          },
        },
        { type: 'result', subtype: 'success', is_error: false },
      ])
    );

    expect(parsed.finalResponse).toBe('Final response');
    expect(parsed.terminal).toBeUndefined();
    expect(parsed.malformedTerminal).toBe(true);
  });

  it.each([
    { type: 'result' },
    { type: 'result', subtype: 'success', is_error: false },
    {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: false,
      result: 'wrong shape',
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'wrong shape',
    },
  ])('rejects structurally malformed terminal event %#', (terminalEvent) => {
    const parsed = parseClaudeStream(
      jsonl([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'partial response' }],
          },
        },
        terminalEvent,
      ])
    );

    expect(parsed.terminal).toBeUndefined();
    expect(parsed.malformedTerminal).toBe(true);
    expect(parsed.diagnostics).toContain(
      'Rejected structurally malformed Claude Code result event'
    );
  });

  it('bounds retained payload while preserving terminal usage', () => {
    const parser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 256,
    });
    for (const event of [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'a'.repeat(1_000) }],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'b'.repeat(1_000),
            },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Finished successfully with a response longer than the limit.',
        total_cost_usd: 0.25,
        usage: { input_tokens: 100, output_tokens: 25 },
      },
    ]) {
      parser.acceptLine(JSON.stringify(event));
    }

    const parsed = parser.finish();

    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(256);
    expect(parsed.retainedContentTruncated).toBe(true);
    expect(parsed.finalResponse).toBe(
      'Finished successfully with a response longer than the limit.'
    );
    expect(parsed.terminal).toMatchObject({
      subtype: 'success',
      isError: false,
    });
    expect(parsed.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      costUsd: 0.25,
      source: 'measured',
    });
    expect(parsed.diagnostics.at(-1)).toMatch(/^Retained Claude event content/);
  });

  it('bounds adversarial malformed-line diagnostics', () => {
    const parser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 512,
    });
    for (let index = 0; index < 10_000; index += 1) {
      parser.acceptLine(`malformed-${index}`);
    }

    const parsed = parser.finish();

    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(512);
    expect(parsed.retainedContentTruncated).toBe(true);
    expect(parsed.diagnostics.length).toBeLessThan(100);
    expect(parsed.diagnostics[0]).toBe('Ignored malformed JSONL line 1');
  });

  it('tracks structured errors independently of a zero-byte retention budget', () => {
    const parser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 0,
    });
    parser.acceptLine(
      JSON.stringify({
        type: 'error',
        error: { message: 'provider failure that cannot be retained' },
      })
    );
    parser.acceptLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'nominal success',
        usage: { input_tokens: 3, output_tokens: 1 },
      })
    );

    const parsed = parser.finish();

    expect(parsed.errorEventCount).toBe(1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.terminal?.isError).toBe(false);
    expect(parsed.usage.totalTokens).toBe(4);
    expect(parsed.retainedContentBytes).toBe(0);
  });

  it('bounds huge initialization arrays in a stream without a terminal event', () => {
    const parser = new ClaudeStreamParser({
      retainEvents: false,
      maxRetainedBytes: 1024,
    });
    parser.acceptLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 's'.repeat(10_000),
        model: 'm'.repeat(10_000),
        claude_code_version: 'v'.repeat(10_000),
        permissionMode: 'p'.repeat(10_000),
        tools: Array.from(
          { length: 1_000 },
          (_, index) => `tool-${index}-${'x'.repeat(100)}`
        ),
        agents: Array.from(
          { length: 1_000 },
          (_, index) => `agent-${index}-${'y'.repeat(100)}`
        ),
        skills: Array.from(
          { length: 1_000 },
          (_, index) => `skill-${index}-${'z'.repeat(100)}`
        ),
      })
    );

    const parsed = parser.finish();

    expect(parsed.terminal).toBeUndefined();
    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(1024);
    expect(parsed.retainedContentTruncated).toBe(true);
    expect(
      Buffer.byteLength(
        JSON.stringify({
          init: parsed.init,
          sessionId: parsed.sessionId,
          model: parsed.model,
          diagnostics: parsed.diagnostics,
        }),
        'utf8'
      )
    ).toBeLessThan(1400);
  });

  it('uses a finite default retention bound', () => {
    const parsed = parseClaudeStream(
      jsonl([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'x'.repeat(11 * 1024 * 1024) }],
          },
        },
      ])
    );

    expect(parsed.retainedContentBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(parsed.retainedContentTruncated).toBe(true);
  });

  it('keeps malformed non-terminal lines as diagnostics', () => {
    const parsed = parseClaudeStream(
      [
        'not json',
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'ok',
        }),
      ].join('\n')
    );

    expect(parsed.finalResponse).toBe('ok');
    expect(parsed.diagnostics).toEqual(['Ignored malformed JSONL line 1']);
    expect(parsed.malformedTerminal).toBe(false);
  });

  it('marks a malformed terminal event without throwing', () => {
    const parsed = parseClaudeStream(
      '{"type":"result","subtype":"success","result":'
    );

    expect(parsed.terminal).toBeUndefined();
    expect(parsed.malformedTerminal).toBe(true);
    expect(parsed.diagnostics).toEqual(['Ignored malformed JSONL line 1']);
  });
});
