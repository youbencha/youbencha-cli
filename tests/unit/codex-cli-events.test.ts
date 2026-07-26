import {
  CodexEventParser,
  parseCodexEventStream,
} from '../../src/adapters/codex-cli-events.js';

describe('CodexEventParser', () => {
  it('extracts final output, tools, thread id, and measured usage', () => {
    const parsed = parseCodexEventStream(
      [
        '{"type":"thread.started","thread_id":"thread-1"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"npm test","exit_code":0,"status":"completed"}}',
        '{"type":"item.completed","item":{"id":"file-1","type":"file_change","changes":[{"path":"src/a.ts","kind":"update"}]}}',
        '{"type":"item.completed","item":{"id":"mcp-1","type":"mcp_tool_call","server":"docs","tool":"search","arguments":{"q":"x"},"status":"completed"}}',
        '{"type":"item.completed","item":{"id":"web-1","type":"web_search","query":"Codex CLI"}}',
        '{"type":"item.completed","item":{"id":"plan-1","type":"plan_update","plan":[{"step":"test","status":"completed"}]}}',
        '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"Done."}}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":3,"output_tokens":4,"reasoning_output_tokens":2}}',
      ].join('\n')
    );

    expect(parsed.terminal).toBe('completed');
    expect(parsed.protocolErrorCount).toBe(0);
    expect(parsed.telemetry.sessionId).toBe('thread-1');
    expect(parsed.telemetry.finalResponse).toBe('Done.');
    expect(parsed.telemetry.usage).toEqual({
      promptTokens: 10,
      cachedPromptTokens: 3,
      completionTokens: 4,
      reasoningTokens: 2,
      totalTokens: 14,
      source: 'measured',
    });
    expect(
      parsed.telemetry.messages?.flatMap((message) => message.tool_calls ?? [])
    ).toHaveLength(5);
  });

  it('accepts unknown events and chunk boundaries', () => {
    const parser = new CodexEventParser();
    parser.pushChunk('{"type":"future.ev');
    parser.pushChunk(
      'ent"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'
    );
    parser.pushChunk('{"type":"turn.completed"}');
    const parsed = parser.finish();

    expect(parsed.unknownEventTypes).toEqual(['future.event']);
    expect(parsed.telemetry.finalResponse).toBe('ok');
    expect(parsed.terminal).toBe('completed');
  });

  it('redacts structured messages, errors, and tool arguments after parsing', () => {
    const secret = 'token-"quoted\\value';
    const parsed = parseCodexEventStream(
      [
        JSON.stringify({
          type: `extension.${secret}`,
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'tool-1',
            type: 'mcp_tool_call',
            server: 'docs',
            tool: 'search',
            arguments: { token: secret },
          },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: `done ${secret}` },
        }),
        JSON.stringify({
          type: 'turn.completed',
          model: `model-${secret}`,
        }),
      ].join('\n'),
      {
        redact: (value) => value.split(secret).join('[REDACTED]'),
      }
    );

    expect(parsed.terminal).toBe('completed');
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(JSON.stringify(parsed)).toContain('[REDACTED]');
  });

  it('discards oversized unterminated records with bounded diagnostics', () => {
    const parser = new CodexEventParser({
      maxRetainedBytes: 256,
      maxPartialLineBytes: 128,
    });
    parser.pushChunk(`{"type":"unknown","payload":"${'x'.repeat(300)}`);
    parser.pushChunk(
      '"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n{"type":"turn.completed"}\n'
    );
    const parsed = parser.finish();

    expect(parsed.malformedLineCount).toBe(1);
    expect(parsed.terminal).toBe('completed');
    expect(parsed.diagnostics.join('')).not.toContain('x'.repeat(20));
  });

  it('preserves terminal failure when retention is exhausted', () => {
    const parser = new CodexEventParser({ maxRetainedBytes: 1 });
    parser.pushLine(
      '{"type":"turn.failed","error":{"message":"CODEX_API_KEY=very-secret"}}'
    );
    const parsed = parser.finish();

    expect(parsed.terminal).toBe('failed');
    expect(parsed.errors).toEqual([
      expect.objectContaining({ kind: 'turn.failed' }),
    ]);
  });

  it.each([
    {
      name: 'missing terminal',
      lines: [
        '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
      ],
    },
    {
      name: 'missing final message',
      lines: ['{"type":"turn.completed"}'],
    },
    {
      name: 'duplicate completion',
      lines: ['{"type":"turn.completed"}', '{"type":"turn.completed"}'],
    },
    {
      name: 'contradictory terminals',
      lines: [
        '{"type":"turn.completed"}',
        '{"type":"turn.failed","error":{"message":"failed"}}',
      ],
    },
  ])('rejects $name even with a tiny retention budget', ({ lines }) => {
    const parser = new CodexEventParser({ maxRetainedBytes: 1 });
    for (const line of lines) {
      parser.pushLine(line);
    }
    const parsed = parser.finish();
    expect(parsed.protocolErrorCount).toBeGreaterThan(0);
  });
});
