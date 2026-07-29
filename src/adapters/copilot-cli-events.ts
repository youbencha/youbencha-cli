import type { AgentExecutionUsage, AgentExecutionTelemetry } from './base.js';
import type { Message } from '../schemas/youbenchalog.schema.js';

export type CopilotErrorCategory =
  | 'credentials-missing'
  | 'classic-pat-unsupported'
  | 'credentials-expired-or-insufficient'
  | 'organization-policy-denied'
  | 'model-or-entitlement-denied'
  | 'unknown';

export interface CopilotStructuredError {
  message: string;
  category: CopilotErrorCategory;
  errorType?: string;
  statusCode?: number;
  stack?: string;
}

export interface CopilotEventParseResult {
  telemetry: AgentExecutionTelemetry;
  errors: CopilotStructuredError[];
  errorEventCount: number;
  eventCount: number;
  unknownEventTypes: string[];
  diagnostics: string[];
  structured: boolean;
  terminalEventSeen: boolean;
  malformedTerminalEvent: boolean;
  retainedContentBytes: number;
  contentTruncated: boolean;
}

export interface CopilotEventParserOptions {
  defaultTimestamp?: string;
  maxRetainedBytes?: number;
  allowLegacyText?: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface FinalAssistantMessage {
  messageKey: number;
  content: string;
  timestamp: string;
}

const TERMINAL_EVENT_TYPES = new Set([
  'result',
  'session.idle',
  'session.shutdown',
]);
const KNOWN_EVENT_TYPES = new Set([
  'assistant.message',
  'assistant.message_delta',
  'assistant.usage',
  'error',
  'result',
  'session.error',
  'session.idle',
  'session.model_change',
  'session.shutdown',
  'session.start',
  'session.tools_updated',
  'tool.execution_complete',
  'tool.execution_start',
]);
const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const DEFAULT_MAX_RETAINED_BYTES = 10 * 1024 * 1024;
const RETAINED_ENTRY_OVERHEAD_BYTES = 32;

/**
 * Incremental parser for Copilot CLI's `--output-format json` JSONL stream.
 *
 * The parser intentionally validates only fields it consumes. Unknown events
 * and additional fields remain forward compatible, while malformed terminal
 * events are reported separately because they can make a run incomplete.
 */
export class CopilotEventParser {
  private readonly messages: Message[] = [];
  private readonly errors: CopilotStructuredError[] = [];
  private readonly diagnostics: string[] = [];
  private readonly unknownEventTypes = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private readonly defaultTimestamp: string;
  private readonly allowLegacyText: boolean;
  private readonly messageRetention: TextRetentionBudget;
  private readonly finalResponseRetention: ReplaceableTextRetention;
  private eventCount = 0;
  private errorEventCount = 0;
  private structuredLineCount = 0;
  private terminalEventSeen = false;
  private malformedTerminalEvent = false;
  private model: string | undefined;
  private cliVersion: string | undefined;
  private sessionId: string | undefined;
  private promptTokens = 0;
  private cachedPromptTokens = 0;
  private completionTokens = 0;
  private credits = 0;
  private promptTokensSeen = false;
  private cachedPromptTokensSeen = false;
  private completionTokensSeen = false;
  private costUsd = 0;
  private costUsdSeen = false;
  private creditsSeen = false;
  private measuredUsageSeen = false;
  private finalAssistantMessage: FinalAssistantMessage | undefined;
  private finalResponseRecorded = false;
  private legacyText = '';

  constructor(options: CopilotEventParserOptions = {}) {
    this.defaultTimestamp =
      isoTimestamp(options.defaultTimestamp) ?? DEFAULT_TIMESTAMP;
    this.allowLegacyText = options.allowLegacyText ?? false;
    const maxRetainedBytes =
      options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
    if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes <= 0) {
      throw new Error('maxRetainedBytes must be a positive integer');
    }
    const finalResponseBytes = Math.max(1, Math.floor(maxRetainedBytes / 2));
    this.finalResponseRetention = new ReplaceableTextRetention(
      finalResponseBytes
    );
    this.messageRetention = new TextRetentionBudget(
      maxRetainedBytes - finalResponseBytes
    );
  }

  pushLine(rawLine: string): void {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      return;
    }

    const jsonCandidate = stripAnsiOutsideJson(line).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {
      if (looksLikeTerminalEvent(jsonCandidate)) {
        this.malformedTerminalEvent = true;
      }
      if (this.allowLegacyText) {
        this.legacyText = this.finalResponseRetention.replace(
          `${this.legacyText}${line}\n`
        );
      }
      this.addDiagnostic('Ignored non-JSON Copilot output line.');
      return;
    }

    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      this.addDiagnostic(
        'Ignored Copilot JSONL record without a string event type.'
      );
      return;
    }

    this.structuredLineCount += 1;
    this.eventCount += 1;
    this.consumeEvent(parsed.type, parsed);
  }

  finish(): CopilotEventParseResult {
    const finalResponse = this.finalAssistantMessage?.content;
    const structured = this.structuredLineCount > 0;
    const legacyParserUsed =
      this.allowLegacyText && !structured && this.legacyText.trim().length > 0;
    this.appendDeltaOnlyMessages();
    const messages = structured
      ? this.messages
      : legacyParserUsed
        ? [
            {
              role: 'assistant' as const,
              content: this.legacyText.trim(),
              timestamp: this.defaultTimestamp,
            },
          ]
        : [];
    const usage = this.buildUsage();

    const contentTruncated =
      this.messageRetention.truncated || this.finalResponseRetention.truncated;
    const diagnostics = [
      ...this.diagnostics,
      ...(contentTruncated
        ? [
            `Copilot parser retained content was truncated at ${this.retainedContentBytes()} bytes.`,
          ]
        : []),
    ];

    return {
      telemetry: {
        provider: 'GitHub',
        cliVersion: this.cliVersion,
        model: this.model,
        sessionId: this.sessionId,
        finalResponse:
          finalResponse ??
          (legacyParserUsed ? this.legacyText.trim() : undefined),
        usage,
        messages,
        structuredOutputFormat: structured
          ? 'jsonl'
          : legacyParserUsed
            ? 'text'
            : undefined,
        legacyParserUsed,
        diagnostics,
      },
      errors: [...this.errors],
      errorEventCount: this.errorEventCount,
      eventCount: this.eventCount,
      unknownEventTypes: [...this.unknownEventTypes],
      diagnostics,
      structured,
      terminalEventSeen: this.terminalEventSeen,
      malformedTerminalEvent: this.malformedTerminalEvent,
      retainedContentBytes: this.retainedContentBytes(),
      contentTruncated,
    };
  }

  private consumeEvent(type: string, event: JsonObject): void {
    const data = isObject(event.data) ? event.data : {};
    const timestamp =
      isoTimestamp(stringValue(event.timestamp)) ?? this.defaultTimestamp;

    if (!KNOWN_EVENT_TYPES.has(type)) {
      if (
        this.unknownEventTypes.has(type) ||
        !this.messageRetention.reserveEntry()
      ) {
        return;
      }
      const retainedType = this.messageRetention.retain(type);
      if (retainedType) {
        this.unknownEventTypes.add(retainedType);
      }
      return;
    }

    if (TERMINAL_EVENT_TYPES.has(type)) {
      this.terminalEventSeen = true;
    }

    switch (type) {
      case 'session.start':
        this.sessionId =
          this.retainMetadata(stringValue(data.sessionId)) ?? this.sessionId;
        this.cliVersion =
          this.retainMetadata(stringValue(data.copilotVersion)) ??
          this.cliVersion;
        this.model =
          this.retainMetadata(stringValue(data.selectedModel)) ?? this.model;
        break;
      case 'session.model_change':
        this.model =
          this.retainMetadata(stringValue(data.newModel)) ?? this.model;
        break;
      case 'session.tools_updated':
        this.model = this.retainMetadata(stringValue(data.model)) ?? this.model;
        break;
      case 'assistant.message':
        this.consumeAssistantMessage(data, timestamp);
        break;
      case 'assistant.message_delta':
        this.consumeAssistantDelta(data, timestamp);
        break;
      case 'assistant.usage':
        this.consumeAssistantUsage(data);
        break;
      case 'tool.execution_start':
        this.consumeToolStart(data, timestamp);
        break;
      case 'tool.execution_complete':
        this.consumeToolComplete(data, timestamp);
        break;
      case 'session.error':
        this.consumeError(data);
        break;
      case 'error':
        this.consumeError(
          Object.keys(data).length > 0
            ? data
            : isObject(event.error)
              ? event.error
              : event
        );
        break;
      case 'result':
        this.consumeResult(event, data);
        break;
      case 'session.shutdown':
        this.consumeShutdown(data);
        break;
      case 'session.idle':
        break;
    }
  }

  private consumeAssistantMessage(data: JsonObject, timestamp: string): void {
    const messageId = stringValue(data.messageId);
    const content = stringValue(data.content);
    if (!messageId || content === undefined) {
      this.addDiagnostic(
        'Ignored malformed assistant.message event without messageId/content.'
      );
      return;
    }

    const parentToolCallId = stringValue(data.parentToolCallId);
    this.model = this.retainMetadata(stringValue(data.model)) ?? this.model;
    if (typeof data.outputTokens === 'number') {
      this.completionTokens += nonNegativeNumber(data.outputTokens);
      this.completionTokensSeen = true;
      this.measuredUsageSeen = true;
    }
    if (!parentToolCallId && content.length > 0) {
      this.finalAssistantMessage = {
        messageKey: hashString(messageId),
        content: this.finalResponseRetention.replace(content),
        timestamp,
      };
      this.finalResponseRecorded = true;
    }

    const toolRequests = Array.isArray(data.toolRequests)
      ? data.toolRequests
      : [];
    const toolCalls = toolRequests.flatMap((request) => {
      if (!isObject(request)) {
        return [];
      }
      const toolCallId = stringValue(request.toolCallId);
      const name = stringValue(request.name);
      if (!toolCallId || !name) {
        return [];
      }
      const retainedToolCallId = this.messageRetention.retain(toolCallId);
      const retainedName = this.messageRetention.retain(name);
      const retainedArguments = this.messageRetention.retain(
        stringifyValue(request.arguments)
      );
      if (
        !retainedToolCallId ||
        !retainedName ||
        !this.messageRetention.reserveEntry(2)
      ) {
        return [];
      }
      this.toolNames.set(retainedToolCallId, retainedName);
      return [
        {
          id: retainedToolCallId,
          type: request.type === 'custom' ? 'custom' : 'function',
          function: {
            name: retainedName,
            arguments: retainedArguments,
          },
        },
      ];
    });

    const retainedContent = this.messageRetention.retain(content);
    if (!retainedContent && toolCalls.length === 0) {
      return;
    }
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    this.messages.push({
      role: 'assistant',
      content: retainedContent,
      timestamp,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });
  }

  private consumeAssistantDelta(data: JsonObject, timestamp: string): void {
    const messageId = stringValue(data.messageId);
    const delta = stringValue(data.deltaContent);
    if (!messageId || delta === undefined) {
      this.addDiagnostic('Ignored malformed assistant.message_delta event.');
      return;
    }

    if (stringValue(data.parentToolCallId)) {
      return;
    }
    const current =
      this.finalAssistantMessage?.messageKey === hashString(messageId)
        ? this.finalAssistantMessage.content
        : '';
    this.finalAssistantMessage = {
      messageKey: hashString(messageId),
      content: this.finalResponseRetention.replace(`${current}${delta}`),
      timestamp,
    };
    this.finalResponseRecorded = false;
  }

  private consumeAssistantUsage(data: JsonObject): void {
    this.model = this.retainMetadata(stringValue(data.model)) ?? this.model;
    this.promptTokens += nonNegativeNumber(data.inputTokens);
    this.cachedPromptTokens += nonNegativeNumber(data.cacheReadTokens);
    this.completionTokens += nonNegativeNumber(data.outputTokens);
    if (typeof data.cost === 'number') {
      this.credits += nonNegativeNumber(data.cost);
      this.creditsSeen = true;
    }
    const explicitCostUsd = explicitUsdValue(data);
    if (explicitCostUsd !== undefined) {
      this.costUsd += explicitCostUsd;
      this.costUsdSeen = true;
    }
    this.promptTokensSeen ||= typeof data.inputTokens === 'number';
    this.cachedPromptTokensSeen ||= typeof data.cacheReadTokens === 'number';
    this.completionTokensSeen ||= typeof data.outputTokens === 'number';
    this.measuredUsageSeen ||= hasAnyNumber(data, [
      'inputTokens',
      'cacheReadTokens',
      'outputTokens',
      'cost',
      'costUsd',
      'cost_usd',
      'usdCost',
    ]);
  }

  private consumeToolStart(data: JsonObject, timestamp: string): void {
    const toolCallId = stringValue(data.toolCallId);
    const toolName = stringValue(data.toolName);
    if (!toolCallId || !toolName) {
      this.addDiagnostic('Ignored malformed tool.execution_start event.');
      return;
    }

    const alreadyAnnounced = this.toolNames.has(toolCallId);
    if (alreadyAnnounced) {
      return;
    }
    const retainedToolCallId = this.messageRetention.retain(toolCallId);
    const retainedToolName = this.messageRetention.retain(toolName);
    const retainedArguments = this.messageRetention.retain(
      stringifyValue(data.arguments)
    );
    if (!retainedToolCallId || !retainedToolName) {
      return;
    }
    if (!this.messageRetention.reserveEntry(3)) {
      return;
    }
    this.toolNames.set(retainedToolCallId, retainedToolName);
    this.messages.push({
      role: 'assistant',
      content: '',
      timestamp,
      tool_calls: [
        {
          id: retainedToolCallId,
          type: 'function',
          function: {
            name: retainedToolName,
            arguments: retainedArguments,
          },
        },
      ],
    });
  }

  private consumeToolComplete(data: JsonObject, timestamp: string): void {
    const toolCallId = stringValue(data.toolCallId);
    if (!toolCallId) {
      this.addDiagnostic('Ignored malformed tool.execution_complete event.');
      return;
    }

    const result = isObject(data.result) ? data.result : undefined;
    const error = isObject(data.error) ? data.error : undefined;
    const content =
      stringValue(result?.content) ??
      stringValue(error?.message) ??
      (data.success === true ? '' : 'Tool execution failed');

    const retainedToolCallId = this.messageRetention.retain(toolCallId);
    const retainedContent = this.messageRetention.retain(content);
    if (!retainedToolCallId || (!retainedContent && content.length > 0)) {
      return;
    }
    if (!retainedContent && content.length === 0) {
      return;
    }
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    this.messages.push({
      role: 'tool',
      content: retainedContent,
      timestamp,
      tool_call_id: retainedToolCallId,
    });
  }

  private consumeError(data: JsonObject): void {
    const message = stringValue(data.message);
    if (!message) {
      this.addDiagnostic('Ignored malformed session.error event.');
      return;
    }

    this.errorEventCount += 1;
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    const retainedMessage = this.messageRetention.retain(message);
    if (!retainedMessage) {
      return;
    }
    this.errors.push({
      message: retainedMessage,
      category: classifyCopilotError(
        message,
        stringValue(data.errorType),
        numberValue(data.statusCode)
      ),
      errorType:
        this.messageRetention.retain(stringValue(data.errorType) ?? '') ||
        undefined,
      statusCode: numberValue(data.statusCode),
      stack:
        this.messageRetention.retain(stringValue(data.stack) ?? '') ||
        undefined,
    });
  }

  private consumeShutdown(data: JsonObject): void {
    this.model =
      this.retainMetadata(stringValue(data.currentModel)) ?? this.model;
    const totalPremiumRequests = numberValue(data.totalPremiumRequests);
    if (totalPremiumRequests !== undefined) {
      this.credits = Math.max(0, totalPremiumRequests);
      this.creditsSeen = true;
      this.measuredUsageSeen = true;
    }

    if (!isObject(data.modelMetrics)) {
      return;
    }

    let promptTokens = 0;
    let cachedPromptTokens = 0;
    let completionTokens = 0;
    let credits = 0;
    let costUsd = 0;
    let promptTokensSeen = false;
    let cachedPromptTokensSeen = false;
    let completionTokensSeen = false;
    let creditsSeen = false;
    let costUsdSeen = false;

    for (const metric of Object.values(data.modelMetrics)) {
      if (!isObject(metric)) {
        continue;
      }
      const usage = isObject(metric.usage) ? metric.usage : {};
      const requests = isObject(metric.requests) ? metric.requests : {};
      promptTokens += nonNegativeNumber(usage.inputTokens);
      cachedPromptTokens += nonNegativeNumber(usage.cacheReadTokens);
      completionTokens += nonNegativeNumber(usage.outputTokens);
      credits += nonNegativeNumber(requests.cost);
      const explicitCostUsd = explicitUsdValue(requests);
      if (explicitCostUsd !== undefined) {
        costUsd += explicitCostUsd;
        costUsdSeen = true;
      }
      promptTokensSeen ||= typeof usage.inputTokens === 'number';
      cachedPromptTokensSeen ||= typeof usage.cacheReadTokens === 'number';
      completionTokensSeen ||= typeof usage.outputTokens === 'number';
      creditsSeen ||= typeof requests.cost === 'number';
    }

    if (
      promptTokensSeen ||
      cachedPromptTokensSeen ||
      completionTokensSeen ||
      creditsSeen ||
      costUsdSeen
    ) {
      this.promptTokens = promptTokens;
      this.cachedPromptTokens = cachedPromptTokens;
      this.completionTokens = completionTokens;
      this.costUsd = costUsd;
      this.promptTokensSeen = promptTokensSeen;
      this.cachedPromptTokensSeen = cachedPromptTokensSeen;
      this.completionTokensSeen = completionTokensSeen;
      this.costUsdSeen = costUsdSeen;
      if (totalPremiumRequests === undefined && creditsSeen) {
        this.credits = credits;
        this.creditsSeen = true;
      }
      this.measuredUsageSeen = true;
    }
  }

  /**
   * Prompt-mode JSONL ends with a compact, top-level result record rather than
   * the persisted session.shutdown shape.
   */
  private consumeResult(event: JsonObject, data: JsonObject): void {
    const payload = Object.keys(data).length > 0 ? data : event;
    this.sessionId =
      this.retainMetadata(stringValue(event.sessionId)) ??
      this.retainMetadata(stringValue(payload.sessionId)) ??
      this.sessionId;
    this.model =
      this.retainMetadata(stringValue(event.model)) ??
      this.retainMetadata(stringValue(payload.model)) ??
      this.model;

    const exitCode =
      numberValue(event.exitCode) ?? numberValue(payload.exitCode);
    if (exitCode !== undefined && exitCode !== 0) {
      this.addStructuredError(
        `Copilot reported result exit code ${exitCode}.`,
        'unknown'
      );
    }

    const usage = isObject(event.usage)
      ? event.usage
      : isObject(payload.usage)
        ? payload.usage
        : {};
    const reportedCredits = firstNumber(usage, [
      'premiumRequests',
      'aiCredits',
      'credits',
      'cost',
    ]);
    if (reportedCredits !== undefined) {
      this.credits = Math.max(0, reportedCredits);
      this.creditsSeen = true;
      this.measuredUsageSeen = true;
    }
    const explicitCostUsd = explicitUsdValue(usage);
    if (explicitCostUsd !== undefined) {
      this.costUsd = explicitCostUsd;
      this.costUsdSeen = true;
      this.measuredUsageSeen = true;
    }

    const promptTokens =
      numberValue(usage.inputTokens) ?? numberValue(usage.promptTokens);
    const cachedPromptTokens =
      numberValue(usage.cacheReadTokens) ??
      numberValue(usage.cachedPromptTokens);
    const completionTokens =
      numberValue(usage.outputTokens) ?? numberValue(usage.completionTokens);
    if (promptTokens !== undefined) {
      this.promptTokens = Math.max(0, promptTokens);
      this.promptTokensSeen = true;
      this.measuredUsageSeen = true;
    }
    if (cachedPromptTokens !== undefined) {
      this.cachedPromptTokens = Math.max(0, cachedPromptTokens);
      this.cachedPromptTokensSeen = true;
      this.measuredUsageSeen = true;
    }
    if (completionTokens !== undefined) {
      this.completionTokens = Math.max(0, completionTokens);
      this.completionTokensSeen = true;
      this.measuredUsageSeen = true;
    }
  }

  private appendDeltaOnlyMessages(): void {
    const message = this.finalAssistantMessage;
    if (
      !message ||
      this.finalResponseRecorded ||
      message.content.length === 0
    ) {
      return;
    }
    const content = this.messageRetention.retain(message.content);
    if (!content) {
      return;
    }
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    this.messages.push({
      role: 'assistant',
      content,
      timestamp: message.timestamp,
    });
    this.finalResponseRecorded = true;
  }

  private buildUsage(): AgentExecutionUsage {
    if (!this.measuredUsageSeen) {
      return { source: 'unavailable' };
    }

    const usage: AgentExecutionUsage = { source: 'measured' };
    if (this.promptTokensSeen) {
      usage.promptTokens = this.promptTokens;
    }
    if (this.cachedPromptTokensSeen) {
      usage.cachedPromptTokens = this.cachedPromptTokens;
    }
    if (this.completionTokensSeen) {
      usage.completionTokens = this.completionTokens;
    }
    if (this.promptTokensSeen && this.completionTokensSeen) {
      usage.totalTokens = this.promptTokens + this.completionTokens;
    }
    if (this.costUsdSeen) {
      usage.costUsd = this.costUsd;
    }
    if (this.creditsSeen) {
      usage.credits = this.credits;
    }
    return usage;
  }

  private addDiagnostic(message: string): void {
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    const retainedMessage = this.messageRetention.retain(message);
    if (retainedMessage) {
      this.diagnostics.push(retainedMessage);
    }
  }

  private addStructuredError(
    message: string,
    category: CopilotErrorCategory
  ): void {
    this.errorEventCount += 1;
    if (!this.messageRetention.reserveEntry()) {
      return;
    }
    const retainedMessage = this.messageRetention.retain(message);
    if (!retainedMessage) {
      return;
    }
    this.errors.push({ message: retainedMessage, category });
  }

  private retainMetadata(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.messageRetention.retain(value) || undefined;
  }

  private retainedContentBytes(): number {
    return (
      this.messageRetention.retainedBytes +
      this.finalResponseRetention.retainedBytes
    );
  }
}

export function parseCopilotEventStream(
  rawOutput: string,
  options: CopilotEventParserOptions = {}
): CopilotEventParseResult {
  const parser = new CopilotEventParser(options);
  for (const line of rawOutput.split('\n')) {
    parser.pushLine(line);
  }
  return parser.finish();
}

export function classifyCopilotError(
  message: string,
  errorType?: string,
  statusCode?: number
): CopilotErrorCategory {
  const value = `${errorType ?? ''} ${message}`.toLowerCase();
  if (
    value.includes('classic personal access token') ||
    value.includes('classic pat')
  ) {
    return 'classic-pat-unsupported';
  }
  if (
    value.includes('not logged in') ||
    value.includes('must be logged in') ||
    value.includes('no credentials') ||
    value.includes('missing token') ||
    value.includes('authentication required')
  ) {
    return 'credentials-missing';
  }
  if (
    statusCode === 401 ||
    value.includes('expired') ||
    value.includes('bad credentials') ||
    value.includes('insufficient scope')
  ) {
    return 'credentials-expired-or-insufficient';
  }
  if (
    value.includes('organization policy') ||
    value.includes('policy denied') ||
    value.includes('blocked by your organization')
  ) {
    return 'organization-policy-denied';
  }
  if (
    statusCode === 403 ||
    value.includes('entitlement') ||
    value.includes('model is not available') ||
    value.includes('model unavailable') ||
    value.includes('ai credits')
  ) {
    return 'model-or-entitlement-denied';
  }
  return 'unknown';
}

/**
 * Remove terminal control sequences that wrap JSON, without mutating escape
 * bytes inside JSON string values.
 */
export function stripAnsiOutsideJson(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (
        index < value.length &&
        !(value.charCodeAt(index) >= 0x40 && value.charCodeAt(index) <= 0x7e)
      ) {
        index += 1;
      }
      continue;
    }

    if (character === '\u001b' && value[index + 1] === ']') {
      index += 2;
      while (
        index < value.length &&
        value[index] !== '\u0007' &&
        !(value[index] === '\u001b' && value[index + 1] === '\\')
      ) {
        index += 1;
      }
      if (value[index] === '\u001b') {
        index += 1;
      }
      continue;
    }

    result += character;
  }
  return result;
}

class TextRetentionBudget {
  retainedBytes = 0;
  truncated = false;

  constructor(private readonly limitBytes: number) {}

  reserveEntry(count = 1): boolean {
    const bytes = RETAINED_ENTRY_OVERHEAD_BYTES * count;
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      this.retainedBytes + bytes > this.limitBytes
    ) {
      this.truncated = true;
      return false;
    }
    this.retainedBytes += bytes;
    return true;
  }

  retain(value: string): string {
    const remaining = this.limitBytes - this.retainedBytes;
    if (remaining <= 0) {
      this.truncated ||= value.length > 0;
      return '';
    }
    const retained = truncateUtf8(value, remaining);
    const retainedBytes = Buffer.byteLength(retained, 'utf8');
    this.retainedBytes += retainedBytes;
    this.truncated ||= retainedBytes < Buffer.byteLength(value, 'utf8');
    return retained;
  }
}

class ReplaceableTextRetention {
  retainedBytes = 0;
  truncated = false;

  constructor(private readonly limitBytes: number) {}

  replace(value: string): string {
    const retained = truncateUtf8(value, this.limitBytes);
    this.retainedBytes = Buffer.byteLength(retained, 'utf8');
    this.truncated ||= this.retainedBytes < Buffer.byteLength(value, 'utf8');
    return retained;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) {
    return value;
  }

  let end = Math.max(0, maxBytes);
  let truncated = buffer.subarray(0, end).toString('utf8');
  while (end > 0 && truncated.endsWith('\uFFFD')) {
    end -= 1;
    truncated = buffer.subarray(0, end).toString('utf8');
  }
  return truncated;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.length > 40 ||
    !Number.isFinite(Date.parse(value))
  ) {
    return undefined;
  }
  return value;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function nonNegativeNumber(value: unknown): number {
  const number = numberValue(value);
  return number !== undefined && number >= 0 ? number : 0;
}

function hasAnyNumber(value: JsonObject, keys: string[]): boolean {
  return keys.some((key) => typeof value[key] === 'number');
}

function firstNumber(value: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const number = numberValue(value[key]);
    if (number !== undefined) {
      return number;
    }
  }
  return undefined;
}

function explicitUsdValue(value: JsonObject): number | undefined {
  const amount = firstNumber(value, ['costUsd', 'cost_usd', 'usdCost']);
  return amount !== undefined ? Math.max(0, amount) : undefined;
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return '{}';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeTerminalEvent(value: string): boolean {
  return (
    value.includes('"result"') ||
    value.includes('"session.idle"') ||
    value.includes('"session.shutdown"')
  );
}

/** Pure event helpers and retention boundaries for deterministic tests. */
export const copilotEventTesting = {
  truncateUtf8,
  isObject,
  stringValue,
  isoTimestamp,
  numberValue,
  nonNegativeNumber,
  hasAnyNumber,
  firstNumber,
  explicitUsdValue,
  hashString,
  stringifyValue,
  looksLikeTerminalEvent,
  TextRetentionBudget,
  ReplaceableTextRetention,
};
