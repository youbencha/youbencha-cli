# Data Model: Claude Code Adapter

**Phase 1 Output** | **Date**: 2025-11-25  
**Purpose**: Define entities, types, and validation rules for Claude Code adapter

## Core Entities

### 1. ClaudeCodeAdapter

**Description**: Implementation of AgentAdapter interface for Claude Code CLI

**Properties**:
```typescript
class ClaudeCodeAdapter implements AgentAdapter {
  readonly name: string = 'claude-code';
  readonly version: string = '1.0.0';
  
  // Methods from AgentAdapter interface
  checkAvailability(): Promise<boolean>;
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  normalizeLog(result: AgentExecutionResult, context: AgentExecutionContext): YouBenchaLog;
}
```

**Validation Rules**:
- `name` must be 'claude-code' (literal)
- `version` follows semantic versioning (MAJOR.MINOR.PATCH)
- All interface methods must be implemented

**Relationships**:
- Implements: `AgentAdapter` (interface from base.ts)
- Returns: `AgentExecutionResult` from execute()
- Returns: `YouBenchaLog` from normalizeLog()
- Consumes: `AgentExecutionContext` as input

---

### 2. ClaudeCodeConfig

**Description**: Configuration schema for Claude Code-specific options (subset of AgentExecutionContext.config)

**Properties**:
```typescript
interface ClaudeCodeConfig {
  // Required: Mutually exclusive
  prompt?: string;           // Inline prompt text
  prompt_file?: string;      // Path to prompt file (relative to workspace)
  
  // Optional: Agent/Model selection
  agent_name?: string;       // Custom Claude Code agent/subagent name
  model?: string;            // Model identifier (e.g., 'claude-sonnet-4-5-20250929')
  
  // Optional: Advanced CLI features
  append_system_prompt?: string;    // Additional system prompt
  permission_mode?: 'auto' | 'plan' | 'ask';  // Permission handling
  allowed_tools?: string[];         // Tool allowlist
  system_prompt?: string;           // Override system prompt
  
  // Optional: Output control
  max_tokens?: number;              // Response length limit
  temperature?: number;             // Sampling temperature (0-1)
}
```

**Validation Rules**:
- **MUST**: Exactly one of `prompt` or `prompt_file` must be provided
- **prompt**: Non-empty string, max 1,000,000 chars
- **prompt_file**: Valid relative path, no `..`, must exist and be readable
- **agent_name**: Alphanumeric + hyphens/underscores, max 100 chars
- **model**: Must match pattern `claude-[\w\-\.]+` if provided
- **permission_mode**: Enum: 'auto' | 'plan' | 'ask'
- **allowed_tools**: Array of strings, each matching `[\w\-]+`
- **max_tokens**: Integer > 0, ≤ 200000
- **temperature**: Float 0.0 to 1.0

**State Transitions**: N/A (config is immutable after validation)

---

### 3. ClaudeCodeOutput

**Description**: Parsed output structure from Claude Code CLI (internal to normalizeLog)

**Properties**:
```typescript
interface ClaudeCodeOutput {
  rawOutput: string;          // Complete stdout+stderr
  cleanOutput: string;        // ANSI codes stripped
  
  // Extracted metadata
  model?: string;             // Detected model name
  version?: string;           // Claude Code CLI version
  
  // Parsed sections
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
  
  toolCalls: Array<{
    name: string;
    arguments: string;
    result?: string;
  }>;
  
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  
  // Metadata
  truncated: boolean;         // Output exceeded 10MB limit
  parseErrors: string[];      // Issues during parsing
}
```

**Validation Rules**:
- `rawOutput` always present (may be empty string)
- `cleanOutput` derived from rawOutput (never null)
- `messages` array may be empty (valid for failed executions)
- `usage.totalTokens` = `inputTokens + outputTokens` (if present)
- `truncated` true if rawOutput.includes('[OUTPUT TRUNCATED')

**Relationships**:
- Input to: `normalizeLog()` internal logic
- Output from: `parseClaudeOutput()` private method
- Transforms to: `YouBenchaLog` structure

---

### 4. ClaudeCodeCommand

**Description**: Structured representation of CLI command (internal to buildClaudeCommand)

**Properties**:
```typescript
interface ClaudeCodeCommand {
  command: string;            // CLI executable name
  args: string[];             // Argument array (for spawn)
  cwd: string;                // Working directory
  env: Record<string, string>; // Environment variables
  timeout: number;            // Timeout in milliseconds
}
```

**Validation Rules**:
- `command` must be 'claude'
- `args` array length > 0 (at minimum: ['-p', '<prompt>'])
- `cwd` must be absolute path, must exist
- `timeout` >= 0 (0 = no timeout)
- `env` must include ANTHROPIC_API_KEY if not in system env

**State Transitions**:
```
Config → buildClaudeCommand() → ClaudeCodeCommand → spawn() → Process
```

---

## Derived Types

### ExecutionMetadata

**Description**: Timing and status metadata for execution

**Properties**:
```typescript
interface ExecutionMetadata {
  startedAt: string;      // ISO 8601 timestamp
  completedAt: string;    // ISO 8601 timestamp
  duration_ms: number;    // Computed: completedAt - startedAt
  exitCode: number;       // Process exit code
  status: 'success' | 'failed' | 'timeout';
  timedOut: boolean;      // True if timeout enforced
}
```

**Validation Rules**:
- `completedAt` >= `startedAt` (temporal ordering)
- `duration_ms` matches computed difference (within 100ms tolerance)
- `status = 'timeout'` ⟺ `timedOut = true`
- `status = 'success'` ⟺ `exitCode = 0` (unless timeout)
- `status = 'failed'` ⟺ `exitCode ≠ 0` (unless timeout)

---

### ErrorRecord

**Description**: Structured error information

**Properties**:
```typescript
interface ErrorRecord {
  message: string;          // Human-readable error description
  timestamp: string;        // ISO 8601 when error occurred
  code?: string;            // Error code (e.g., 'TIMEOUT', 'AUTH_FAILED')
  stackTrace?: string;      // Stack trace if available
  context?: Record<string, unknown>; // Additional context
}
```

**Validation Rules**:
- `message` non-empty
- `timestamp` valid ISO 8601
- `code` uppercase snake_case pattern (if present)

---

## Validation Schema (Zod)

```typescript
import { z } from 'zod';

export const ClaudeCodeConfigSchema = z.object({
  prompt: z.string().min(1).max(1_000_000).optional(),
  prompt_file: z.string()
    .regex(/^[^\/\.].*$/) // No absolute paths or ..
    .max(500)
    .optional(),
  agent_name: z.string()
    .regex(/^[\w\-]+$/)
    .max(100)
    .optional(),
  model: z.string()
    .regex(/^claude-[\w\-\.]+$/)
    .optional(),
  append_system_prompt: z.string().max(10_000).optional(),
  permission_mode: z.enum(['auto', 'plan', 'ask']).optional(),
  allowed_tools: z.array(z.string().regex(/^[\w\-]+$/)).optional(),
  system_prompt: z.string().max(50_000).optional(),
  max_tokens: z.number().int().positive().max(200_000).optional(),
  temperature: z.number().min(0).max(1).optional(),
}).refine(
  (data) => (data.prompt && !data.prompt_file) || (!data.prompt && data.prompt_file),
  { message: 'Exactly one of prompt or prompt_file must be provided' }
);

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
```

---

## Entity Relationships Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Suite Configuration (YAML)                                  │
│  agent:                                                      │
│    type: claude-code                                        │
│    config: ClaudeCodeConfig ────────────────┐              │
└─────────────────────────────────────────────┼──────────────┘
                                              │
                                              │ validates
                                              ▼
┌──────────────────────────────────────────────────────────────┐
│ AgentExecutionContext                                        │
│  - workspaceDir                                              │
│  - config: Record<string, unknown> ──→ ClaudeCodeConfig     │
│  - timeout                                                   │
│  - env                                                       │
└─────────────────┬────────────────────────────────────────────┘
                  │ input to
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ ClaudeCodeAdapter                                            │
│  - checkAvailability()                                       │
│  - execute(context) ──→ AgentExecutionResult                │
│  - normalizeLog(result, context) ──→ YouBenchaLog           │
└──────────────┬─────────────────┬─────────────────────────────┘
               │                 │
      builds   │                 │ parses
               ▼                 ▼
┌─────────────────────┐ ┌──────────────────────┐
│ ClaudeCodeCommand   │ │ ClaudeCodeOutput     │
│  - command          │ │  - rawOutput         │
│  - args[]           │ │  - messages[]        │
│  - cwd              │ │  - toolCalls[]       │
│  - env              │ │  - usage             │
└──────┬──────────────┘ └──────┬───────────────┘
       │                       │
       │ spawns                │ transforms to
       ▼                       ▼
┌─────────────────┐   ┌────────────────────────┐
│ Claude Code CLI │──→│ YouBenchaLog           │
│  (External)     │   │  - agent_info          │
└─────────────────┘   │  - model_info          │
                      │  - execution           │
                      │  - messages[]          │
                      │  - tool_calls[]        │
                      │  - usage               │
                      └────────────────────────┘
```

---

## Data Flow Sequence

1. **Input**: Suite config YAML/JSON loaded → parsed to `SuiteConfig`
2. **Validation**: `agent.config` validated against `ClaudeCodeConfigSchema`
3. **Context Creation**: Orchestrator creates `AgentExecutionContext`
4. **Adapter Selection**: `getAgentAdapter('claude-code')` → `ClaudeCodeAdapter`
5. **Availability Check**: `adapter.checkAvailability()` validates CLI installed
6. **Command Building**: `buildClaudeCommand(context)` → `ClaudeCodeCommand`
7. **Execution**: `spawn()` runs CLI, captures output → `AgentExecutionResult`
8. **Parsing**: `parseClaudeOutput(result.output)` → `ClaudeCodeOutput`
9. **Normalization**: `normalizeLog(result, context)` → `YouBenchaLog`
10. **Serialization**: `YouBenchaLog` saved to `youbencha-log.json`

---

## Constants

```typescript
// Timeout and limits
export const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
export const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_PROMPT_LENGTH = 1_000_000; // 1M chars

// CLI constants
export const CLAUDE_CLI_COMMAND = 'claude';
export const PRINT_MODE_FLAG = '-p';
export const MODEL_FLAG = '--model';
export const AGENTS_FLAG = '--agents';

// Output parsing patterns
export const MODEL_PATTERN = /Model:\s+([\w\-\.]+)/i;
export const VERSION_PATTERN = /Claude Code (?:CLI )?v?([\d\.]+)/i;
export const INPUT_TOKENS_PATTERN = /Input tokens:\s+(\d+)/i;
export const OUTPUT_TOKENS_PATTERN = /Output tokens:\s+(\d+)/i;
export const TOOL_CALL_PATTERN = /\[TOOL:\s+(\w+)\]\s*([^\n]+)?/gi;
export const ANSI_CODE_PATTERN = /\x1B\[[0-9;]*m/g;

// Error codes
export const ERROR_CODES = {
  CLI_NOT_FOUND: 'CLAUDE_CLI_NOT_FOUND',
  AUTH_FAILED: 'CLAUDE_AUTH_FAILED',
  TIMEOUT: 'CLAUDE_TIMEOUT',
  RATE_LIMIT: 'CLAUDE_RATE_LIMIT',
  OUTPUT_TRUNCATED: 'CLAUDE_OUTPUT_TRUNCATED',
  INVALID_CONFIG: 'CLAUDE_INVALID_CONFIG',
} as const;
```

---

## Field Mappings: ClaudeCodeOutput → YouBenchaLog

| ClaudeCodeOutput Field | YouBenchaLog Field | Transformation |
|------------------------|-------------------|----------------|
| version | agent_info.version | Direct copy (or 'unknown') |
| model | model_info.name | Direct copy (or from config) |
| - | model_info.provider | Fixed: 'anthropic' |
| messages | messages | Map to {role, content, timestamp?} |
| toolCalls | tool_calls | Map to {name, arguments, result?} |
| usage.inputTokens | usage.input_tokens | Direct copy (or 0) |
| usage.outputTokens | usage.output_tokens | Direct copy (or 0) |
| usage.totalTokens | usage.total_tokens | Computed or direct copy |
| truncated | errors[] | If true, add truncation error |
| parseErrors | errors[] | Map to ErrorRecord[] |

---

## Immutability and State

- **Immutable**: All config objects after validation
- **Immutable**: `AgentExecutionResult` after execution completes
- **Immutable**: `YouBenchaLog` after normalization
- **Mutable**: Output buffering during execution (accumulates data)
- **Mutable**: `ClaudeCodeAdapter` instance methods (but no instance state)

**Rationale**: Immutability ensures reproducibility and prevents bugs from side effects. Only I/O operations (spawn, read) have necessary mutability.

---

**Phase 1 Data Model Complete** | **Ready for Contracts Generation**
