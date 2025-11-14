/*
  youBencha Log — Types & Adapter Stubs (v0.1)
  -----------------------------------------------------
  - Generated TypeScript types from the proposed JSON Schema
  - Minimal adapter stubs for Copilot / Claude / Codex / Gemini
  - Helper utilities for normalization & artifact references

  Notes:
  - This is SDK-style code meant to live under: packages/youbencha-core/src/
  - Runtime validation is optional; you can wire Ajv or zod if desired.
*/

// =========================
// 1) Types (from schema)
// =========================

export type YouBenchaLogSchemaVersion = "youbencha-log-0.1";

export type ToolId = "copilot" | "claude" | "codex" | "gemini" | "other";
export type SessionMode = "chat" | "task" | "agent";
export type OutputMode = "fs" | "patch" | "command-stream";
export type SessionStatus = "success" | "failed" | "partial" | "cancelled";
export type Actor = "human" | "ci";
export type Role = "user" | "system" | "assistant" | "tool";
export type Channel = "cli" | "editor" | "agent";
export type ContentType = "text" | "code" | "image" | "diff" | "command";
export type EventType =
  | "command.exec"
  | "file.patch"
  | "file.write"
  | "agent.step"
  | "evaluator.start"
  | "evaluator.end";

export interface YouBenchaSession {
  id: string;
  tool: ToolId;
  tool_version?: string;
  mode?: SessionMode;
  output_mode?: OutputMode;
  started_at: string; // ISO datetime
  ended_at?: string;  // ISO datetime
  status: SessionStatus;
}

export interface YouBenchaIdentity {
  actor?: Actor;
  user_hash?: string;
  org_hash?: string;
}

export interface YouBenchaRepoRef {
  url: string;
  branch?: string;
  commit?: string;
}

export interface YouBenchaWorkspace {
  source_dir?: string;
  modified_dir?: string;
  expected_dir?: string;
}

export interface YouBenchaEnvironment {
  os: string;
  arch?: string;
  node?: string;
  container_digest?: string;
  network_policy?: "off" | "allowlist";
  seed?: number;
  repo: YouBenchaRepoRef;
  workspace?: YouBenchaWorkspace;
}

export interface YouBenchaModelParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  // allow provider-specific params here
  [k: string]: unknown;
}

export interface YouBenchaModel {
  provider: string; // e.g., "openai", "anthropic", "google", "azure", "github", "other"
  name: string;     // e.g., "gpt-4.1-mini"
  params?: YouBenchaModelParams;
}

export interface YouBenchaCost {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  vendor_cost_usd?: number;
  currency?: string; // default USD
}

export interface YouBenchaToolCall {
  name: string; // bash.run, fs.patch, etc.
  id: string;
  args?: Record<string, unknown>;
}

export interface YouBenchaAttachment {
  type: string; // file | image | etc.
  path?: string;
  uri?: string;
  [k: string]: unknown;
}

export interface YouBenchaMessage {
  id: string;
  ts: string; // ISO datetime
  role: Role;
  channel?: Channel;
  content_type?: ContentType;
  content: string; // serialized content for plaintext/code; for binary, attach artifact and reference here
  attachments?: YouBenchaAttachment[];
  tool_calls?: YouBenchaToolCall[];
  latency_ms?: number;
}

export interface YouBenchaEventBase {
  ts: string; // ISO datetime
  type: EventType;
}

export interface YouBenchaEventCommandExec extends YouBenchaEventBase {
  type: "command.exec";
  command: string;
  cwd?: string;
  exit_code?: number;
  duration_ms?: number;
  stdout_ref?: string; // artifact://logs/build-stdout.txt
  stderr_ref?: string; // artifact://logs/build-stderr.txt
}

export interface YouBenchaEventFilePatch extends YouBenchaEventBase {
  type: "file.patch";
  file: string;
  patch_ref?: string; // artifact://patches/0001.patch
  lines_added?: number;
  lines_removed?: number;
  entropy?: number;
}

export interface YouBenchaEventFileWrite extends YouBenchaEventBase {
  type: "file.write";
  file: string;
  bytes?: number;
  sha256?: string;
}

export interface YouBenchaEventAgentStep extends YouBenchaEventBase {
  type: "agent.step";
  label?: string;
  detail?: string;
}

export interface YouBenchaEventEvaluatorStart extends YouBenchaEventBase {
  type: "evaluator.start";
  name: string;
}

export interface YouBenchaEventEvaluatorEnd extends YouBenchaEventBase {
  type: "evaluator.end";
  name: string;
  status?: "passed" | "failed" | "skipped";
  duration_ms?: number;
  artifact_ref?: string;
}

export type YouBenchaEvent =
  | YouBenchaEventCommandExec
  | YouBenchaEventFilePatch
  | YouBenchaEventFileWrite
  | YouBenchaEventAgentStep
  | YouBenchaEventEvaluatorStart
  | YouBenchaEventEvaluatorEnd;

export interface YouBenchaArtifact {
  name: string;
  type: string; // e.g., unified-diff, text, json, binary
  uri: string;  // artifact://...
  sha256?: string;
  size_bytes?: number;
}

export interface YouBenchaPrivacy {
  pii_redaction?: boolean;
  hash_salt_id?: string;
}

export interface YouBenchaSummary {
  intent?: string;
  outcome?: string;
  notes?: string;
  errors?: string[];
}

export interface YouBenchaProvenance {
  adapter: string;      // e.g., youbencha-adapter-copilot-cli@0.1.0
  agent_version: string; // e.g., 0.9.0
  generator?: string;   // e.g., youbencha-cli@0.9.0
}

export interface YouBenchaLog {
  schema_version: YouBenchaLogSchemaVersion; // "agent-log-0.1"
  session: YouBenchaSession;
  identity?: YouBenchaIdentity;
  environment: YouBenchaEnvironment;
  model: YouBenchaModel;
  cost?: YouBenchaCost;
  messages: YouBenchaMessage[];
  events?: YouBenchaEvent[];
  artifacts?: YouBenchaArtifact[];
  privacy?: YouBenchaPrivacy;
  summary?: YouBenchaSummary;
  provenance: YouBenchaProvenance;
}

// =========================
// 2) Utilities
// =========================

export interface NewYouBenchaLogOpts {
  tool: ToolId;
  sessionId: string;
  sessionStatus?: SessionStatus;
  startedAt?: string; // ISO
  endedAt?: string;   // ISO
  environment: YouBenchaEnvironment;
  model: YouBenchaModel;
  provenance: YouBenchaProvenance;
}

export function newYouBenchaLog(opts: NewYouBenchaLogOpts): YouBenchaLog {
  const now = new Date().toISOString();
  return {
    schema_version: "agent-log-0.1",
    session: {
      id: opts.sessionId,
      tool: opts.tool,
      started_at: opts.startedAt ?? now,
      ended_at: opts.endedAt,
      status: opts.sessionStatus ?? "success",
    },
    environment: opts.environment,
    model: opts.model,
    messages: [],
    provenance: opts.provenance,
  };
}

export function addArtifact(log: YouBenchaLog, artifact: YouBenchaArtifact) {
  if (!log.artifacts) log.artifacts = [];
  log.artifacts.push(artifact);
}

export function addEvent(log: YouBenchaLog, event: YouBenchaEvent) {
  if (!log.events) log.events = [];
  log.events.push(event);
}

export function addMessage(log: YouBenchaLog, message: YouBenchaMessage) {
  log.messages.push(message);
}

export function artifactUri(kind: string, name: string) {
  return `artifact://${kind}/${name}`;
}

// =========================
// 3) Adapter stubs
// =========================
// These are minimal mappers from vendor artifacts → YouBenchaLog. They are intentionally
// permissive about input shapes to accommodate vendor drift and community tooling.

// ---- 3.1 Copilot (IDE/CLI hybrid) -----------------------------------------

/**
 * Rough input shapes we may encounter for Copilot:
 *  - VS Code chatSessions/*.json (workspaceStorage) — message arrays
 *  - CLI/agent stdout & a structured JSON sidecar, if present
 */
export interface CopilotChatSessionJSON {
  id?: string;
  items: Array<{
    id?: string;
    timestamp?: string | number; // ms epoch or ISO
    role?: "user" | "assistant" | "system";
    text?: string;
    code?: string;
  }>;
}

export interface CopilotAdapterInput {
  chatSessions: CopilotChatSessionJSON[]; // 1+ sessions merged or the target session
  toolVersion?: string;
  // Optional extras discovered via diagnostics
  cost?: Partial<YouBenchaCost>;
}

export function adaptCopilot(
  input: CopilotAdapterInput,
  base: NewYouBenchaLogOpts
): YouBenchaLog {
  const log = newYouBenchaLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as YouBenchaCost;

  for (const sess of input.chatSessions) {
    for (const item of sess.items ?? []) {
      const content = item.code ?? item.text ?? "";
      const ts = typeof item.timestamp === "number"
        ? new Date(item.timestamp).toISOString()
        : (item.timestamp ?? new Date().toISOString());

      addMessage(log, {
        id: item.id ?? cryptoLikeId(),
        ts,
        role: (item.role as Role) ?? "user",
        channel: "editor",
        content_type: item.code ? "code" : "text",
        content,
      });
    }
  }
  return log;
}

// ---- 3.2 Claude Code (CLI + community runners) -----------------------------

export interface ClaudeTranscriptLine {
  ts?: string;        // ISO
  role: Role;         // user | assistant | tool | system
  content: string;    // text/diff/command
  content_type?: ContentType;
}

export interface ClaudeAdapterInput {
  transcript: ClaudeTranscriptLine[];
  patches?: Array<{ file: string; patchPath: string; linesAdded?: number; linesRemoved?: number; entropy?: number }>; // from .specstory/history or similar
  commands?: Array<{ command: string; cwd?: string; exitCode?: number; durationMs?: number; stdoutPath?: string; stderrPath?: string; ts?: string }>;
  cost?: Partial<YouBenchaCost>;
  toolVersion?: string;
}

export function adaptClaude(
  input: ClaudeAdapterInput,
  base: NewYouBenchaLogOpts
): YouBenchaLog {
  const log = newYouBenchaLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as YouBenchaCost;

  for (const line of input.transcript) {
    addMessage(log, {
      id: cryptoLikeId(),
      ts: line.ts ?? new Date().toISOString(),
      role: line.role,
      channel: "cli",
      content_type: line.content_type ?? inferContentType(line.content),
      content: line.content,
    });
  }

  for (const p of input.patches ?? []) {
    addArtifact(log, {
      name: `patch-${basename(p.patchPath)}`,
      type: "unified-diff",
      uri: artifactUri("patches", basename(p.patchPath)),
    });
    addEvent(log, {
      ts: new Date().toISOString(),
      type: "file.patch",
      file: p.file,
      patch_ref: artifactUri("patches", basename(p.patchPath)),
      lines_added: p.linesAdded,
      lines_removed: p.linesRemoved,
      entropy: p.entropy,
    });
  }

  for (const c of input.commands ?? []) {
    addEvent(log, {
      ts: c.ts ?? new Date().toISOString(),
      type: "command.exec",
      command: c.command,
      cwd: c.cwd,
      exit_code: c.exitCode,
      duration_ms: c.durationMs,
      stdout_ref: c.stdoutPath ? artifactUri("logs", basename(c.stdoutPath)) : undefined,
      stderr_ref: c.stderrPath ? artifactUri("logs", basename(c.stderrPath)) : undefined,
    });
  }

  return log;
}

// ---- 3.3 OpenAI Codex (legacy) ---------------------------------------------

/**
 * Many community setups store JSONL under ~/.codex/sessions/<id>.jsonl
 * Each line resembles { ts, role, content, tokens_in, tokens_out }
 */
export interface CodexJsonlRecord {
  ts?: string | number;
  role: Role;
  content: string;
  tokens_in?: number;
  tokens_out?: number;
}

export interface CodexAdapterInput {
  sessionId: string;
  jsonlRecords: CodexJsonlRecord[];
  toolVersion?: string;
}

export function adaptCodex(
  input: CodexAdapterInput,
  base: NewYouBenchaLogOpts
): YouBenchaLog {
  const log = newYouBenchaLog(base);
  log.session.tool_version = input.toolVersion;

  let inTok = 0, outTok = 0;
  for (const r of input.jsonlRecords) {
    const ts = typeof r.ts === "number" ? new Date(r.ts).toISOString() : (r.ts ?? new Date().toISOString());
    addMessage(log, {
      id: cryptoLikeId(),
      ts,
      role: r.role,
      channel: "cli",
      content_type: "text",
      content: r.content,
    });
    inTok += r.tokens_in ?? 0;
    outTok += r.tokens_out ?? 0;
  }

  log.cost = {
    input_tokens: inTok || undefined,
    output_tokens: outTok || undefined,
  };

  return log;
}

// ---- 3.4 Gemini CLI ---------------------------------------------------------

/**
 * Some local CLIs persist JSON under ~/.gemini/tmp/session-*.json
 * Represent it here as a loose array of message-like entries.
 */
export interface GeminiSessionEntry {
  id?: string;
  time?: string | number;
  role: Role;
  text?: string;
  code?: string;
  tool?: string;
}

export interface GeminiAdapterInput {
  entries: GeminiSessionEntry[];
  commands?: Array<{ command: string; cwd?: string; exitCode?: number; durationMs?: number; stdoutPath?: string; stderrPath?: string; ts?: string }>;
  cost?: Partial<YouBenchaCost>;
  toolVersion?: string;
}

export function adaptGemini(
  input: GeminiAdapterInput,
  base: NewYouBenchaLogOpts
): YouBenchaLog {
  const log = newYouBenchaLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as YouBenchaCost;

  for (const e of input.entries) {
    const ts = typeof e.time === "number" ? new Date(e.time).toISOString() : (e.time ?? new Date().toISOString());
    addMessage(log, {
      id: e.id ?? cryptoLikeId(),
      ts,
      role: e.role,
      channel: "cli",
      content_type: e.code ? "code" : "text",
      content: e.code ?? e.text ?? "",
    });
  }

  for (const c of input.commands ?? []) {
    addEvent(log, {
      ts: c.ts ?? new Date().toISOString(),
      type: "command.exec",
      command: c.command,
      cwd: c.cwd,
      exit_code: c.exitCode,
      duration_ms: c.durationMs,
      stdout_ref: c.stdoutPath ? artifactUri("logs", basename(c.stdoutPath)) : undefined,
      stderr_ref: c.stderrPath ? artifactUri("logs", basename(c.stderrPath)) : undefined,
    });
  }

  return log;
}

// =========================
// 4) Tiny helpers
// =========================

export function cryptoLikeId(): string {
  // Not cryptographically strong; good enough for local IDs
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function inferContentType(s: string | undefined): ContentType {
  if (!s) return "text";
  if (s.startsWith("diff --git") || s.startsWith("@@ ") || s.includes("+++ ") || s.includes("--- ")) return "diff";
  if (/\b(function|const|let|class|import|export)\b/.test(s)) return "code";
  if (/^\$\s/.test(s) || /\bnpm\b|\byarn\b|\bmake\b/.test(s)) return "command";
  return "text";
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

// =========================
// 5) Example usage (pseudo)
// =========================
/*
import { newYouBenchaLog, adaptCopilot } from "./agent-log";

const base = {
  tool: "copilot" as const,
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  environment: {
    os: process.platform,
    repo: { url: "https://github.com/org/repo", branch: "main", commit: "abcdef1" },
  },
  model: { provider: "openai", name: "gpt-4.1-mini", params: { temperature: 0.2 } },
  provenance: { adapter: "youbencha-adapter-copilot-cli@0.1.0", agent_version: "0.9.0", generator: "youbencha-cli@0.9.0" },
};

const log = adaptCopilot({ chatSessions: [loadVSCodeChatSessionJSON()] }, base);
writeFileSync("results/agent-log-123.json", JSON.stringify(log, null, 2));
*/

