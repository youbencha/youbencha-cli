import type { AgentExecutionTelemetry, AgentExecutionUsage } from './base.js';
import type { Message, ToolCall } from '../schemas/youbenchalog.schema.js';

export interface CodexStructuredError {
  message: string;
  kind: 'turn.failed' | 'error' | 'protocol';
}

export interface CodexEventParseResult {
  telemetry: AgentExecutionTelemetry;
  errors: CodexStructuredError[];
  eventCount: number;
  unknownEventTypes: string[];
  diagnostics: string[];
  terminal: 'completed' | 'failed' | 'contradictory' | 'missing';
  contentTruncated: boolean;
  malformedLineCount: number;
  protocolErrorCount: number;
  finalMessageObserved: boolean;
}

export interface CodexEventParserOptions {
  defaultTimestamp?: string;
  maxRetainedBytes?: number;
  maxPartialLineBytes?: number;
  redact?: (value: string) => string;
}

type JsonObject = Record<string, unknown>;

const KNOWN_EVENTS = new Set([
  'thread.started',
  'turn.started',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.completed',
  'turn.failed',
  'error',
]);
const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const DEFAULT_LIMIT = 10 * 1024 * 1024;
const DEFAULT_PARTIAL_LINE_LIMIT = 1024 * 1024;
const ENTRY_OVERHEAD_BYTES = 32;

export class CodexEventParser {
  private readonly defaultTimestamp: string;
  private readonly retention: RetentionBudget;
  private readonly maxPartialLineBytes: number;
  private readonly redact: (value: string) => string;
  private readonly messages: Message[] = [];
  private readonly errors: CodexStructuredError[] = [];
  private readonly diagnostics: string[] = [];
  private readonly unknownEvents = new Set<string>();
  private partialLine = '';
  private discardingOversizedLine = false;
  private eventCount = 0;
  private malformedLineCount = 0;
  private completedTerminals = 0;
  private failedTerminals = 0;
  private topLevelErrors = 0;
  private protocolErrorCount = 0;
  private threadId: string | undefined;
  private model: string | undefined;
  private finalResponse: string | undefined;
  private finalMessageObserved = false;
  private usage: AgentExecutionUsage = { source: 'unavailable' };

  constructor(options: CodexEventParserOptions = {}) {
    this.defaultTimestamp =
      validTimestamp(options.defaultTimestamp) ?? DEFAULT_TIMESTAMP;
    this.redact = options.redact ?? ((value): string => value);
    const limit = options.maxRetainedBytes ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('maxRetainedBytes must be a positive integer');
    }
    this.retention = new RetentionBudget(limit);
    this.maxPartialLineBytes =
      options.maxPartialLineBytes ?? DEFAULT_PARTIAL_LINE_LIMIT;
    if (
      !Number.isSafeInteger(this.maxPartialLineBytes) ||
      this.maxPartialLineBytes <= 0
    ) {
      throw new Error('maxPartialLineBytes must be a positive integer');
    }
  }

  pushChunk(chunk: string): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf('\n', offset);
      const piece =
        newline === -1 ? chunk.slice(offset) : chunk.slice(offset, newline);
      if (!this.discardingOversizedLine) {
        this.partialLine += piece;
        if (
          Buffer.byteLength(this.partialLine, 'utf8') > this.maxPartialLineBytes
        ) {
          this.partialLine = '';
          this.discardingOversizedLine = true;
          this.malformedLineCount += 1;
          this.addDiagnostic(
            'Discarded a Codex JSONL record that exceeded the configured line limit.'
          );
        }
      }
      if (newline === -1) {
        break;
      }
      if (!this.discardingOversizedLine) {
        this.pushLine(this.partialLine);
      }
      this.partialLine = '';
      this.discardingOversizedLine = false;
      offset = newline + 1;
    }
  }

  pushLine(rawLine: string): void {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) {
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.malformedLineCount += 1;
      this.addDiagnostic('Ignored malformed Codex JSONL record.');
      return;
    }
    if (!isObject(value) || typeof value.type !== 'string') {
      this.malformedLineCount += 1;
      this.addDiagnostic(
        'Ignored Codex JSONL record without a string event type.'
      );
      return;
    }
    const sanitized = redactJsonValue(value, this.redact);
    if (!isObject(sanitized) || typeof sanitized.type !== 'string') {
      return;
    }
    this.eventCount += 1;
    if (!KNOWN_EVENTS.has(sanitized.type)) {
      if (
        !this.unknownEvents.has(sanitized.type) &&
        this.retention.reserve(sanitized.type, ENTRY_OVERHEAD_BYTES)
      ) {
        this.unknownEvents.add(sanitized.type);
      }
      return;
    }
    this.consume(sanitized.type, sanitized);
  }

  finish(): CodexEventParseResult {
    if (this.partialLine.trim()) {
      this.pushLine(this.partialLine);
      this.partialLine = '';
    }
    const terminal =
      this.completedTerminals > 1
        ? 'contradictory'
        : this.completedTerminals > 0 &&
            (this.failedTerminals > 0 || this.topLevelErrors > 0)
          ? 'contradictory'
          : this.failedTerminals > 0 || this.topLevelErrors > 0
            ? 'failed'
            : this.completedTerminals === 1
              ? 'completed'
              : 'missing';
    if (this.completedTerminals > 1) {
      this.protocolErrorCount += 1;
      this.addError(
        'protocol',
        'Codex emitted more than one turn.completed terminal event.'
      );
    }
    if (terminal === 'contradictory') {
      this.protocolErrorCount += 1;
      this.addError(
        'protocol',
        'Codex emitted contradictory success and failure terminals.'
      );
    } else if (terminal === 'missing') {
      this.protocolErrorCount += 1;
      this.addError(
        'protocol',
        'Codex JSONL stream ended without a terminal event.'
      );
    }
    if (terminal === 'completed' && !this.finalMessageObserved) {
      this.protocolErrorCount += 1;
      this.addError(
        'protocol',
        'Codex completed the turn without a completed agent_message item.'
      );
    }
    if (
      terminal === 'failed' &&
      !this.errors.some(
        (error) => error.kind === 'turn.failed' || error.kind === 'error'
      )
    ) {
      // This fixed-size sentinel preserves failure semantics when the shared
      // retention budget was already exhausted by untrusted content.
      this.errors.push({
        kind: this.failedTerminals > 0 ? 'turn.failed' : 'error',
        message:
          'Codex reported a terminal failure; details exceeded the retention limit.',
      });
    }
    return {
      telemetry: {
        provider: 'OpenAI',
        sessionId: this.threadId,
        model: this.model,
        finalResponse: this.finalResponse,
        usage: this.usage,
        messages: this.messages,
        structuredOutputFormat: 'jsonl',
        legacyParserUsed: false,
        diagnostics: [...this.diagnostics],
      },
      errors: [...this.errors],
      eventCount: this.eventCount,
      unknownEventTypes: [...this.unknownEvents],
      diagnostics: [...this.diagnostics],
      terminal,
      contentTruncated: this.retention.truncated,
      malformedLineCount: this.malformedLineCount,
      protocolErrorCount: this.protocolErrorCount,
      finalMessageObserved: this.finalMessageObserved,
    };
  }

  private consume(type: string, event: JsonObject): void {
    if (type === 'thread.started') {
      this.threadId = retainString(event.thread_id, this.retention);
      return;
    }
    if (type === 'turn.completed') {
      this.completedTerminals += 1;
      this.consumeUsage(event.usage);
      this.model = retainString(event.model, this.retention) ?? this.model;
      return;
    }
    if (type === 'turn.failed') {
      this.failedTerminals += 1;
      this.recordError('turn.failed', errorMessage(event));
      return;
    }
    if (type === 'error') {
      this.topLevelErrors += 1;
      this.recordError('error', errorMessage(event));
      return;
    }
    if (
      (type === 'item.started' ||
        type === 'item.updated' ||
        type === 'item.completed') &&
      isObject(event.item)
    ) {
      this.consumeItem(type, event.item);
    }
  }

  private consumeItem(eventType: string, item: JsonObject): void {
    if (eventType !== 'item.completed') {
      return;
    }
    const itemType = stringValue(item.type);
    const id = stringValue(item.id) ?? `codex-item-${this.eventCount}`;
    if (itemType === 'agent_message') {
      const text =
        stringValue(item.text) ??
        stringValue(item.content) ??
        stringValue(item.message);
      if (text) {
        this.finalMessageObserved = true;
        const retained = this.retention.retainBounded(
          text,
          ENTRY_OVERHEAD_BYTES
        );
        if (retained !== undefined) {
          this.finalResponse = retained;
          this.messages.push(this.message('assistant', retained));
        }
      }
      return;
    }
    if (itemType === 'reasoning') {
      return;
    }
    const tool = toolCallForItem(itemType, id, item, this.retention);
    if (tool) {
      const summary = itemSummary(itemType, item);
      const retained = this.retention.retain(summary, ENTRY_OVERHEAD_BYTES);
      if (retained !== undefined) {
        this.messages.push({
          ...this.message('assistant', retained),
          tool_calls: [tool],
        });
      }
    }
  }

  private consumeUsage(value: unknown): void {
    if (!isObject(value)) {
      return;
    }
    const promptTokens = nonNegativeNumber(value.input_tokens);
    const cachedPromptTokens = nonNegativeNumber(value.cached_input_tokens);
    const completionTokens = nonNegativeNumber(value.output_tokens);
    const reasoningTokens =
      nonNegativeNumber(value.reasoning_output_tokens) ??
      nonNegativeNumber(value.reasoning_tokens);
    const measured = [
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
    ].some((entry) => entry !== undefined);
    this.usage = {
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens:
        promptTokens !== undefined || completionTokens !== undefined
          ? (promptTokens ?? 0) + (completionTokens ?? 0)
          : undefined,
      source: measured ? 'measured' : 'unavailable',
    };
  }

  private recordError(kind: 'turn.failed' | 'error', message: string): void {
    this.addError(kind, message);
  }

  private addError(kind: CodexStructuredError['kind'], message: string): void {
    const retained = this.retention.retain(message, ENTRY_OVERHEAD_BYTES);
    if (retained !== undefined) {
      this.errors.push({ kind, message: retained });
    }
  }

  private addDiagnostic(message: string): void {
    const retained = this.retention.retain(message, ENTRY_OVERHEAD_BYTES);
    if (retained !== undefined) {
      this.diagnostics.push(retained);
    }
  }

  private message(role: Message['role'], content: string): Message {
    return { role, content, timestamp: this.defaultTimestamp };
  }
}

export function parseCodexEventStream(
  raw: string,
  options: CodexEventParserOptions = {}
): CodexEventParseResult {
  const parser = new CodexEventParser(options);
  parser.pushChunk(raw);
  return parser.finish();
}

function toolCallForItem(
  type: string | undefined,
  id: string,
  item: JsonObject,
  retention: RetentionBudget
): ToolCall | undefined {
  const names: Record<string, string> = {
    command_execution: 'command_execution',
    file_change: 'file_change',
    mcp_tool_call: 'mcp_tool_call',
    web_search: 'web_search',
    plan_update: 'plan_update',
  };
  if (!type || !names[type]) {
    return undefined;
  }
  const args =
    type === 'command_execution'
      ? {
          command: item.command,
          exit_code: item.exit_code,
          status: item.status,
        }
      : type === 'mcp_tool_call'
        ? {
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            status: item.status,
          }
        : type === 'web_search'
          ? { query: item.query }
          : type === 'plan_update'
            ? { plan: item.plan }
            : { changes: item.changes, status: item.status };
  const serializedArguments = safeJson(args);
  if (
    !retention.reserve(
      `${id}${names[type]}${serializedArguments}`,
      ENTRY_OVERHEAD_BYTES
    )
  ) {
    return undefined;
  }
  return {
    id,
    type: 'function',
    function: { name: names[type], arguments: serializedArguments },
  };
}

function itemSummary(type: string | undefined, item: JsonObject): string {
  switch (type) {
    case 'command_execution':
      return `Command: ${stringValue(item.command) ?? '(unknown command)'} (exit ${String(item.exit_code ?? 'unknown')})`;
    case 'file_change':
      return `File changes: ${safeJson(item.changes ?? item.status ?? 'completed')}`;
    case 'mcp_tool_call':
      return `MCP tool: ${stringValue(item.server) ?? 'unknown'}/${stringValue(item.tool) ?? 'unknown'}`;
    case 'web_search':
      return `Web search: ${stringValue(item.query) ?? '(query unavailable)'}`;
    case 'plan_update':
      return `Plan update: ${safeJson(item.plan ?? 'updated')}`;
    default:
      return type ?? 'Codex item';
  }
}

function errorMessage(event: JsonObject): string {
  if (typeof event.message === 'string') {
    return event.message;
  }
  if (isObject(event.error) && typeof event.error.message === 'string') {
    return event.error.message;
  }
  if (typeof event.error === 'string') {
    return event.error;
  }
  return 'Codex reported an unspecified error.';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactJsonValue(
  value: unknown,
  redact: (value: string) => string
): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry, redact));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactJsonValue(entry, redact),
      ])
    );
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function retainString(
  value: unknown,
  retention: RetentionBudget
): string | undefined {
  const string = stringValue(value);
  return string ? retention.retain(string, ENTRY_OVERHEAD_BYTES) : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function validTimestamp(value: string | undefined): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

class RetentionBudget {
  private used = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  reserve(value: string, overhead = 0): boolean {
    const bytes = Buffer.byteLength(value, 'utf8') + overhead;
    if (this.used + bytes > this.limit) {
      this.truncated = true;
      return false;
    }
    this.used += bytes;
    return true;
  }

  retain(value: string, overhead = 0): string | undefined {
    if (!this.reserve(value, overhead)) {
      return undefined;
    }
    return value;
  }

  retainBounded(value: string, overhead = 0): string | undefined {
    const available = this.limit - this.used - overhead;
    if (available <= 0) {
      this.truncated = true;
      return undefined;
    }
    const source = Buffer.from(value, 'utf8');
    if (source.length <= available) {
      this.used += source.length + overhead;
      return value;
    }
    this.used = this.limit;
    this.truncated = true;
    return source.subarray(0, available).toString('utf8');
  }
}
