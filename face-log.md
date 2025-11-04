/*
  FACE Log — Types & Adapter Stubs (v0.1)
  -----------------------------------------------------
  - Generated TypeScript types from the proposed JSON Schema
  - Minimal adapter stubs for Copilot / Claude / Codex / Gemini
  - Helper utilities for normalization & artifact references

  Notes:
  - This is SDK-style code meant to live under: packages/face-core/src/
  - Runtime validation is optional; you can wire Ajv or zod if desired.
*/

// =========================
// 1) Types (from schema)
// =========================

export type FaceLogSchemaVersion = "face-log-0.1";

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

export interface FaceSession {
  id: string;
  tool: ToolId;
  tool_version?: string;
  mode?: SessionMode;
  output_mode?: OutputMode;
  started_at: string; // ISO datetime
  ended_at?: string;  // ISO datetime
  status: SessionStatus;
}

export interface FaceIdentity {
  actor?: Actor;
  user_hash?: string;
  org_hash?: string;
}

export interface FaceRepoRef {
  url: string;
  branch?: string;
  commit?: string;
}

export interface FaceWorkspace {
  source_dir?: string;
  modified_dir?: string;
  expected_dir?: string;
}

export interface FaceEnvironment {
  os: string;
  arch?: string;
  node?: string;
  container_digest?: string;
  network_policy?: "off" | "allowlist";
  seed?: number;
  repo: FaceRepoRef;
  workspace?: FaceWorkspace;
}

export interface FaceModelParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  // allow provider-specific params here
  [k: string]: unknown;
}

export interface FaceModel {
  provider: string; // e.g., "openai", "anthropic", "google", "azure", "github", "other"
  name: string;     // e.g., "gpt-4.1-mini"
  params?: FaceModelParams;
}

export interface FaceCost {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  vendor_cost_usd?: number;
  currency?: string; // default USD
}

export interface FaceToolCall {
  name: string; // bash.run, fs.patch, etc.
  id: string;
  args?: Record<string, unknown>;
}

export interface FaceAttachment {
  type: string; // file | image | etc.
  path?: string;
  uri?: string;
  [k: string]: unknown;
}

export interface FaceMessage {
  id: string;
  ts: string; // ISO datetime
  role: Role;
  channel?: Channel;
  content_type?: ContentType;
  content: string; // serialized content for plaintext/code; for binary, attach artifact and reference here
  attachments?: FaceAttachment[];
  tool_calls?: FaceToolCall[];
  latency_ms?: number;
}

export interface FaceEventBase {
  ts: string; // ISO datetime
  type: EventType;
}

export interface FaceEventCommandExec extends FaceEventBase {
  type: "command.exec";
  command: string;
  cwd?: string;
  exit_code?: number;
  duration_ms?: number;
  stdout_ref?: string; // artifact://logs/build-stdout.txt
  stderr_ref?: string; // artifact://logs/build-stderr.txt
}

export interface FaceEventFilePatch extends FaceEventBase {
  type: "file.patch";
  file: string;
  patch_ref?: string; // artifact://patches/0001.patch
  lines_added?: number;
  lines_removed?: number;
  entropy?: number;
}

export interface FaceEventFileWrite extends FaceEventBase {
  type: "file.write";
  file: string;
  bytes?: number;
  sha256?: string;
}

export interface FaceEventAgentStep extends FaceEventBase {
  type: "agent.step";
  label?: string;
  detail?: string;
}

export interface FaceEventEvaluatorStart extends FaceEventBase {
  type: "evaluator.start";
  name: string;
}

export interface FaceEventEvaluatorEnd extends FaceEventBase {
  type: "evaluator.end";
  name: string;
  status?: "passed" | "failed" | "skipped";
  duration_ms?: number;
  artifact_ref?: string;
}

export type FaceEvent =
  | FaceEventCommandExec
  | FaceEventFilePatch
  | FaceEventFileWrite
  | FaceEventAgentStep
  | FaceEventEvaluatorStart
  | FaceEventEvaluatorEnd;

export interface FaceArtifact {
  name: string;
  type: string; // e.g., unified-diff, text, json, binary
  uri: string;  // artifact://...
  sha256?: string;
  size_bytes?: number;
}

export interface FacePrivacy {
  pii_redaction?: boolean;
  hash_salt_id?: string;
}

export interface FaceSummary {
  intent?: string;
  outcome?: string;
  notes?: string;
  errors?: string[];
}

export interface FaceProvenance {
  adapter: string;      // e.g., face-adapter-copilot-cli@0.1.0
  face_version: string; // e.g., 0.9.0
  generator?: string;   // e.g., face-cli@0.9.0
}

export interface FaceLog {
  schema_version: FaceLogSchemaVersion; // "face-log-0.1"
  session: FaceSession;
  identity?: FaceIdentity;
  environment: FaceEnvironment;
  model: FaceModel;
  cost?: FaceCost;
  messages: FaceMessage[];
  events?: FaceEvent[];
  artifacts?: FaceArtifact[];
  privacy?: FacePrivacy;
  summary?: FaceSummary;
  provenance: FaceProvenance;
}

// =========================
// 2) Utilities
// =========================

export interface NewFaceLogOpts {
  tool: ToolId;
  sessionId: string;
  sessionStatus?: SessionStatus;
  startedAt?: string; // ISO
  endedAt?: string;   // ISO
  environment: FaceEnvironment;
  model: FaceModel;
  provenance: FaceProvenance;
}

export function newFaceLog(opts: NewFaceLogOpts): FaceLog {
  const now = new Date().toISOString();
  return {
    schema_version: "face-log-0.1",
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

export function addArtifact(log: FaceLog, artifact: FaceArtifact) {
  if (!log.artifacts) log.artifacts = [];
  log.artifacts.push(artifact);
}

export function addEvent(log: FaceLog, event: FaceEvent) {
  if (!log.events) log.events = [];
  log.events.push(event);
}

export function addMessage(log: FaceLog, message: FaceMessage) {
  log.messages.push(message);
}

export function artifactUri(kind: string, name: string) {
  return `artifact://${kind}/${name}`;
}

// =========================
// 3) Adapter stubs
// =========================
// These are minimal mappers from vendor artifacts → FaceLog. They are intentionally
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
  cost?: Partial<FaceCost>;
}

export function adaptCopilot(
  input: CopilotAdapterInput,
  base: NewFaceLogOpts
): FaceLog {
  const log = newFaceLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as FaceCost;

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
  cost?: Partial<FaceCost>;
  toolVersion?: string;
}

export function adaptClaude(
  input: ClaudeAdapterInput,
  base: NewFaceLogOpts
): FaceLog {
  const log = newFaceLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as FaceCost;

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
  base: NewFaceLogOpts
): FaceLog {
  const log = newFaceLog(base);
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
  cost?: Partial<FaceCost>;
  toolVersion?: string;
}

export function adaptGemini(
  input: GeminiAdapterInput,
  base: NewFaceLogOpts
): FaceLog {
  const log = newFaceLog(base);
  log.session.tool_version = input.toolVersion;
  if (input.cost) log.cost = { ...input.cost } as FaceCost;

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
import { newFaceLog, adaptCopilot } from "./face-log";

const base = {
  tool: "copilot" as const,
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  environment: {
    os: process.platform,
    repo: { url: "https://github.com/org/repo", branch: "main", commit: "abcdef1" },
  },
  model: { provider: "openai", name: "gpt-4.1-mini", params: { temperature: 0.2 } },
  provenance: { adapter: "face-adapter-copilot-cli@0.1.0", face_version: "0.9.0", generator: "face-cli@0.9.0" },
};

const log = adaptCopilot({ chatSessions: [loadVSCodeChatSessionJSON()] }, base);
writeFileSync("results/face-log-123.json", JSON.stringify(log, null, 2));
*/
