/**
 * Parser for Claude Code's `--output-format stream-json` JSONL protocol.
 *
 * The protocol is intentionally treated as forward compatible: known fields
 * are extracted while the original event objects and unknown event types are
 * retained for diagnostics and artifacts.
 */

export interface ClaudeStreamInit {
  sessionId?: string;
  model?: string;
  claudeCodeVersion?: string;
  permissionMode?: string;
  tools: string[];
  agents: string[];
  skills: string[];
}

export interface ClaudeStreamUsage {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  source: 'measured' | 'estimated' | 'unavailable';
}

export interface ClaudeToolEvent {
  kind: 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  isError?: boolean;
}

export interface ClaudeRetryEvent {
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  error?: string;
}

export interface ClaudeStreamTerminal {
  subtype?: string;
  isError: boolean;
  result?: string;
}

export interface ClaudeStreamParseResult {
  events: Record<string, unknown>[];
  init?: ClaudeStreamInit;
  assistantMessages: string[];
  toolEvents: ClaudeToolEvent[];
  retries: ClaudeRetryEvent[];
  usage: ClaudeStreamUsage;
  finalResponse?: string;
  sessionId?: string;
  model?: string;
  terminal?: ClaudeStreamTerminal;
  errors: string[];
  errorEventCount: number;
  diagnostics: string[];
  unknownEventTypes: string[];
  malformedTerminal: boolean;
  retainedContentTruncated: boolean;
  retainedContentBytes: number;
}

export interface ClaudeStreamParserOptions {
  retainEvents?: boolean;
  maxRetainedBytes?: number;
}

interface ClaudeStreamRetention {
  retainText(value: string): string | undefined;
  retainTerminalText(value: string): string | undefined;
  retainValue(value: unknown): unknown;
  reserve(bytes: number): boolean;
  reserveTerminal(bytes: number): boolean;
  addDiagnostic(message: string): void;
}

const DEFAULT_MAX_RETAINED_BYTES = 10 * 1024 * 1024;
const RETAINED_ITEM_OVERHEAD_BYTES = 32;
const TRUNCATION_DIAGNOSTIC_RESERVE_BYTES = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function contentBlocks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textFromContent(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  return contentBlocks(value)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);
}

function usageFromRecord(value: unknown): ClaudeStreamUsage {
  if (!isRecord(value)) {
    return { source: 'unavailable' };
  }

  return {
    inputTokens:
      optionalNumber(value.input_tokens) ?? optionalNumber(value.inputTokens),
    cacheCreationInputTokens:
      optionalNumber(value.cache_creation_input_tokens) ??
      optionalNumber(value.cacheCreationInputTokens),
    cacheReadInputTokens:
      optionalNumber(value.cache_read_input_tokens) ??
      optionalNumber(value.cacheReadInputTokens),
    outputTokens:
      optionalNumber(value.output_tokens) ?? optionalNumber(value.outputTokens),
    costUsd: optionalNumber(value.cost_usd) ?? optionalNumber(value.costUSD),
    source: 'measured',
  };
}

function mergeUsage(
  target: ClaudeStreamUsage,
  source: ClaudeStreamUsage,
  replace: boolean
): void {
  const keys: Array<
    | 'inputTokens'
    | 'cacheCreationInputTokens'
    | 'cacheReadInputTokens'
    | 'outputTokens'
  > = [
    'inputTokens',
    'cacheCreationInputTokens',
    'cacheReadInputTokens',
    'outputTokens',
  ];

  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = replace ? value : (target[key] ?? 0) + value;
    }
  }
}

function calculateTotalTokens(usage: ClaudeStreamUsage): number | undefined {
  const tokenValues = [
    usage.inputTokens,
    usage.cacheCreationInputTokens,
    usage.cacheReadInputTokens,
    usage.outputTokens,
  ];

  if (tokenValues.every((value) => value === undefined)) {
    return undefined;
  }

  return tokenValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function parseAssistantEvent(
  event: Record<string, unknown>,
  result: ClaudeStreamParseResult,
  retention: ClaudeStreamRetention
): void {
  if (!isRecord(event.message)) {
    retention.addDiagnostic('Assistant event did not contain a message object');
    return;
  }

  const message = event.message;
  const model = optionalString(message.model);
  if (model && model !== result.model) {
    result.model = retention.retainText(model);
  }

  const texts = textFromContent(message.content);
  if (texts.length > 0 && retention.reserve(32)) {
    const text = retention.retainText(texts.join(''));
    if (text !== undefined) {
      result.assistantMessages.push(text);
    }
  }

  for (const block of contentBlocks(message.content)) {
    if (block.type === 'tool_use' && retention.reserve(64)) {
      result.toolEvents.push({
        kind: 'tool_use',
        id: retainOptionalString(block.id, retention),
        name: retainOptionalString(block.name, retention),
        input: retention.retainValue(block.input),
      });
    }
  }

  mergeUsage(result.usage, usageFromRecord(message.usage), false);
}

function parseUserEvent(
  event: Record<string, unknown>,
  result: ClaudeStreamParseResult,
  retention: ClaudeStreamRetention
): void {
  if (!isRecord(event.message)) {
    return;
  }

  for (const block of contentBlocks(event.message.content)) {
    if (block.type === 'tool_result' && retention.reserve(64)) {
      result.toolEvents.push({
        kind: 'tool_result',
        id: retainOptionalString(block.tool_use_id, retention),
        content: retention.retainValue(block.content),
        isError:
          typeof block.is_error === 'boolean' ? block.is_error : undefined,
      });
    }
  }
}

function parseSystemEvent(
  event: Record<string, unknown>,
  result: ClaudeStreamParseResult,
  retention: ClaudeStreamRetention
): void {
  const subtype = optionalString(event.subtype);
  if (subtype === 'init') {
    const init: ClaudeStreamInit = {
      sessionId: retainOptionalString(event.session_id, retention),
      model: retainOptionalString(event.model, retention),
      claudeCodeVersion: retainOptionalString(
        event.claude_code_version,
        retention
      ),
      permissionMode: retainOptionalString(event.permissionMode, retention),
      tools: retainStringArray(event.tools, retention),
      agents: retainStringArray(event.agents, retention),
      skills: retainStringArray(event.skills, retention),
    };
    result.init = init;
    result.sessionId = init.sessionId ?? result.sessionId;
    result.model = init.model ?? result.model;
    return;
  }

  if (subtype === 'api_retry' || subtype === 'retry') {
    if (retention.reserve(48)) {
      result.retries.push({
        attempt: optionalNumber(event.attempt),
        maxRetries: optionalNumber(event.max_retries),
        delayMs:
          optionalNumber(event.retry_delay_ms) ??
          optionalNumber(event.delay_ms),
        error: retainOptionalString(
          optionalString(event.error) ?? optionalString(event.error_message),
          retention
        ),
      });
    }
  }
}

function parseResultEvent(
  event: Record<string, unknown>,
  result: ClaudeStreamParseResult,
  retention: ClaudeStreamRetention
): void {
  const subtype = optionalString(event.subtype);
  const hasBooleanError = typeof event.is_error === 'boolean';
  const isError = event.is_error === true;
  const terminalResult = optionalString(event.result);

  const terminalUsage = usageFromRecord(event.usage);
  if (
    calculateTotalTokens(terminalUsage) === undefined &&
    isRecord(event.modelUsage)
  ) {
    for (const modelUsage of Object.values(event.modelUsage)) {
      mergeUsage(terminalUsage, usageFromRecord(modelUsage), false);
      if (isRecord(modelUsage)) {
        const modelCost =
          optionalNumber(modelUsage.costUSD) ??
          optionalNumber(modelUsage.cost_usd);
        if (modelCost !== undefined) {
          terminalUsage.costUsd = (terminalUsage.costUsd ?? 0) + modelCost;
        }
      }
    }
  }
  mergeUsage(result.usage, terminalUsage, true);
  const cost = optionalNumber(event.total_cost_usd) ?? terminalUsage.costUsd;
  if (cost !== undefined) {
    result.usage.costUsd = cost;
  }

  const structurallyValid =
    subtype !== undefined &&
    subtype.length > 0 &&
    hasBooleanError &&
    ((isError && subtype !== 'success') ||
      (!isError && subtype === 'success' && terminalResult !== undefined));
  if (!structurallyValid) {
    result.malformedTerminal = true;
    retention.addDiagnostic(
      'Rejected structurally malformed Claude Code result event'
    );
    return;
  }

  const retainedSubtype = retention.retainTerminalText(subtype);
  const retainedResult =
    terminalResult !== undefined
      ? retention.retainTerminalText(terminalResult)
      : undefined;
  result.terminal = {
    subtype: retainedSubtype,
    isError,
    result: retainedResult,
  };
  result.sessionId =
    retainOptionalTerminalString(event.session_id, retention) ??
    result.sessionId;
  if (retainedResult !== undefined) {
    result.finalResponse = retainedResult;
  }

  if (isError) {
    if (retention.reserveTerminal(RETAINED_ITEM_OVERHEAD_BYTES)) {
      const error = retention.retainTerminalText(
        terminalResult ??
          optionalString(event.error) ??
          `Claude Code failed with result subtype "${subtype}"`
      );
      if (error !== undefined) {
        result.errors.push(error);
      }
    }
  }
}

function parseErrorEvent(
  event: Record<string, unknown>,
  result: ClaudeStreamParseResult,
  retention: ClaudeStreamRetention
): void {
  result.errorEventCount += 1;
  const nestedError = isRecord(event.error) ? event.error : undefined;
  if (retention.reserve(RETAINED_ITEM_OVERHEAD_BYTES)) {
    const error = retention.retainText(
      optionalString(event.message) ??
        optionalString(event.error) ??
        optionalString(nestedError?.message) ??
        'Claude Code reported an unspecified error'
    );
    if (error !== undefined) {
      result.errors.push(error);
    }
  }
}

function retainOptionalString(
  value: unknown,
  retention: ClaudeStreamRetention
): string | undefined {
  const text = optionalString(value);
  return text === undefined ? undefined : retention.retainText(text);
}

function retainOptionalTerminalString(
  value: unknown,
  retention: ClaudeStreamRetention
): string | undefined {
  const text = optionalString(value);
  return text === undefined ? undefined : retention.retainTerminalText(text);
}

function retainStringArray(
  value: unknown,
  retention: ClaudeStreamRetention
): string[] {
  const retained: string[] = [];
  for (const item of optionalStringArray(value)) {
    if (!retention.reserve(RETAINED_ITEM_OVERHEAD_BYTES)) {
      break;
    }
    const text = retention.retainText(item);
    if (text !== undefined) {
      retained.push(text);
    }
  }
  return retained;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  const source = Buffer.from(value, 'utf8');
  if (source.length <= maxBytes) {
    return value;
  }

  let end = maxBytes;
  while (end > 0 && (source[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return source.subarray(0, end).toString('utf8');
}

/**
 * Parse a complete Claude Code JSONL stream.
 *
 * Malformed non-terminal lines are diagnostics. A malformed line that appears
 * to be a terminal result is explicitly marked so callers can fail the run.
 */
export class ClaudeStreamParser {
  private readonly result: ClaudeStreamParseResult = {
    events: [],
    assistantMessages: [],
    toolEvents: [],
    retries: [],
    usage: { source: 'unavailable' },
    errors: [],
    errorEventCount: 0,
    diagnostics: [],
    unknownEventTypes: [],
    malformedTerminal: false,
    retainedContentTruncated: false,
    retainedContentBytes: 0,
  };
  private readonly unknownTypes = new Set<string>();
  private lineNumber = 0;
  private retainedBytes = 0;
  private readonly maxRetainedBytes: number;
  private readonly nonTerminalCeiling: number;
  private readonly terminalCeiling: number;

  constructor(
    private readonly options: ClaudeStreamParserOptions = {
      retainEvents: true,
    }
  ) {
    const configuredLimit = options.maxRetainedBytes;
    if (
      configuredLimit !== undefined &&
      (!Number.isSafeInteger(configuredLimit) || configuredLimit < 0)
    ) {
      throw new Error('maxRetainedBytes must be a non-negative integer');
    }
    this.maxRetainedBytes = configuredLimit ?? DEFAULT_MAX_RETAINED_BYTES;
    const diagnosticReserve = Math.min(
      TRUNCATION_DIAGNOSTIC_RESERVE_BYTES,
      this.maxRetainedBytes > 0
        ? Math.max(1, Math.floor(this.maxRetainedBytes / 8))
        : 0
    );
    this.terminalCeiling = this.maxRetainedBytes - diagnosticReserve;
    this.nonTerminalCeiling = Math.min(
      Math.floor(this.maxRetainedBytes / 2),
      this.terminalCeiling
    );
  }

  acceptLine(rawLine: string): void {
    this.lineNumber += 1;
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.addDiagnostic(`Ignored malformed JSONL line ${this.lineNumber}`);
      if (/"type"\s*:\s*"result"/.test(line)) {
        this.result.malformedTerminal = true;
      }
      return;
    }

    if (!isRecord(parsed)) {
      this.addDiagnostic(
        `Ignored JSONL line ${this.lineNumber} because it was not an object`
      );
      return;
    }

    if (
      this.options.retainEvents !== false &&
      this.reserve(
        Buffer.byteLength(line, 'utf8') + RETAINED_ITEM_OVERHEAD_BYTES
      )
    ) {
      this.result.events.push(parsed);
    }
    const type = optionalString(parsed.type);

    switch (type) {
      case 'system':
        parseSystemEvent(parsed, this.result, this);
        break;
      case 'assistant':
        parseAssistantEvent(parsed, this.result, this);
        break;
      case 'user':
        parseUserEvent(parsed, this.result, this);
        break;
      case 'result':
        parseResultEvent(parsed, this.result, this);
        break;
      case 'error':
        parseErrorEvent(parsed, this.result, this);
        break;
      default: {
        const unknownType = type ?? '<missing>';
        if (
          !this.unknownTypes.has(unknownType) &&
          this.reserve(Buffer.byteLength(unknownType, 'utf8') + 8)
        ) {
          this.unknownTypes.add(unknownType);
        }
        break;
      }
    }
  }

  finish(): ClaudeStreamParseResult {
    if (this.result.finalResponse === undefined) {
      this.result.finalResponse = this.result.assistantMessages.at(-1);
    }
    this.result.usage.totalTokens = calculateTotalTokens(this.result.usage);
    this.result.usage.source =
      this.result.usage.totalTokens !== undefined ||
      this.result.usage.costUsd !== undefined
        ? 'measured'
        : 'unavailable';
    this.result.unknownEventTypes = [...this.unknownTypes];
    this.result.retainedContentBytes = this.retainedBytes;
    if (this.result.retainedContentTruncated) {
      this.addTerminalDiagnostic(
        `Retained Claude event content was truncated at ${this.maxRetainedBytes} bytes; the raw event artifact remains complete`
      );
      this.result.retainedContentBytes = this.retainedBytes;
    }
    return this.result;
  }

  retainText(value: string): string | undefined {
    return this.retainTextWithin(value, this.nonTerminalCeiling);
  }

  retainTerminalText(value: string): string | undefined {
    return this.retainTextWithin(value, this.terminalCeiling);
  }

  private retainTextWithin(value: string, ceiling: number): string | undefined {
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (this.reserveWithin(byteLength, ceiling)) {
      return value;
    }

    const remaining = Math.max(0, ceiling - this.retainedBytes);
    const truncated = truncateUtf8(value, remaining);
    const retainedLength = Buffer.byteLength(truncated, 'utf8');
    this.retainedBytes += retainedLength;
    this.result.retainedContentTruncated = true;
    return truncated.length > 0 ? truncated : undefined;
  }

  retainValue(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }
    const serialized = JSON.stringify(value);
    if (this.reserve(Buffer.byteLength(serialized, 'utf8'))) {
      return value;
    }
    return this.retainText(serialized);
  }

  reserve(bytes: number): boolean {
    return this.reserveWithin(bytes, this.nonTerminalCeiling);
  }

  reserveTerminal(bytes: number): boolean {
    return this.reserveWithin(bytes, this.terminalCeiling);
  }

  private reserveWithin(bytes: number, ceiling: number): boolean {
    if (this.retainedBytes + bytes <= ceiling) {
      this.retainedBytes += bytes;
      return true;
    }
    this.result.retainedContentTruncated = true;
    return false;
  }

  addDiagnostic(message: string): void {
    const retained = this.retainText(message);
    if (retained !== undefined) {
      this.result.diagnostics.push(retained);
    }
  }

  private addTerminalDiagnostic(message: string): void {
    const retained = this.retainTextWithin(message, this.maxRetainedBytes);
    if (retained !== undefined) {
      this.result.diagnostics.push(retained);
    }
  }
}

export function parseClaudeStream(rawOutput: string): ClaudeStreamParseResult {
  const parser = new ClaudeStreamParser();
  for (const line of rawOutput.split(/\r?\n/)) {
    parser.acceptLine(line);
  }

  return parser.finish();
}
