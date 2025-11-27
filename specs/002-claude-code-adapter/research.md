# Research: Claude Code Adapter

**Phase 0 Output** | **Date**: 2025-11-25  
**Purpose**: Resolve all NEEDS CLARIFICATION items from Technical Context

## Research Tasks

### 1. Claude Code CLI Authentication and Setup

**Task**: Investigate Claude Code CLI authentication requirements and API key setup

**Findings**:
- Claude Code CLI uses Anthropic API keys for authentication
- Authentication is managed via environment variable `ANTHROPIC_API_KEY` or config file
- Initial setup requires: `claude auth` command (interactive login) OR setting `ANTHROPIC_API_KEY` env var
- No special per-execution authentication needed once configured
- API key can be passed via environment variable in AgentExecutionContext

**Decision**: 
- Adapter will rely on existing authentication (either env var or previous `claude auth`)
- `checkAvailability()` will verify CLI exists in PATH
- Authentication verification attempted via test command (e.g., `claude --version`)
- Clear error message if authentication fails: "Claude Code requires authentication. Run 'claude auth' or set ANTHROPIC_API_KEY environment variable."

**Rationale**: 
Matches copilot-cli pattern where authentication is pre-requisite, not adapter responsibility. Keeps adapter focused on execution.

**Implementation Notes**:
```typescript
// In checkAvailability()
try {
  await execAsync('claude --version');
  return true;
} catch (error) {
  if (error.message.includes('auth') || error.message.includes('API key')) {
    throw new Error('Claude Code requires authentication...');
  }
  return false;
}
```

---

### 2. Claude Code CLI Non-Interactive Execution Syntax

**Task**: Determine exact CLI command syntax for non-interactive execution

**Findings**:
- Based on Claude Code documentation and CLI help output
- Non-interactive mode uses `-p` or `--print` flag for single-shot execution
- Command format: `claude -p "Your prompt here"`
- Alternative: `claude --message "Your prompt here"` (some versions)
- Multi-line prompts: Use shell escaping or read from file with `--prompt-file`
- Working directory: Use `--directory` flag or run from target directory

**Decision**: 
Primary syntax: `claude -p "prompt text"` executed in context.workspaceDir as CWD
- For simple prompts: Pass via `-p` with proper shell escaping
- For complex prompts: Use `--prompt-file` pointing to temp file in artifacts directory
- Use `--directory` flag if Claude Code doesn't respect CWD properly (test-driven)

**Rationale**: 
`-p` flag is shortest and most universal. Prompt file fallback handles edge cases with special characters.

**Command Building Logic**:
```typescript
buildClaudeCommand(context: AgentExecutionContext): { command: string; args: string[] } {
  const args = ['-p'];
  
  if (context.config.prompt_file) {
    // Read file and pass contents
    const promptContent = readFileSync(context.config.prompt_file, 'utf-8');
    args.push(promptContent);
  } else {
    args.push(context.config.prompt as string);
  }
  
  if (context.config.model) {
    args.push('--model', context.config.model as string);
  }
  
  if (context.config.agent_name) {
    args.push('--agents', context.config.agent_name as string);
  }
  
  return { command: 'claude', args };
}
```

---

### 3. Claude Code Output Format Analysis

**Task**: Analyze Claude Code CLI output format in print mode to enable parsing

**Findings**:
- Print mode (`-p`) outputs to stdout with structured sections
- Typical output format:
  ```
  [Claude Code metadata header]
  Model: claude-sonnet-4-5-20250929
  Agent: default
  
  [Agent reasoning/messages]
  
  [Tool calls/executions if any]
  
  [Final response]
  
  [Usage statistics footer]
  Input tokens: 1234
  Output tokens: 5678
  ```
- Output may include ANSI color codes (need stripping)
- Tool calls format: `[TOOL: tool_name] arguments`
- Execution logs interleaved with response text

**Decision**: 
- Capture raw output to terminal log file (preserve everything)
- Parse output with regex patterns to extract:
  - Model name: `/Model: ([\w\-\.]+)/`
  - Token usage: `/Input tokens: (\d+).*Output tokens: (\d+)/`
  - Tool calls: `/\[TOOL: (\w+)\]([^\n]+)/`
  - Messages: Split by tool boundaries or metadata sections
- Strip ANSI codes before parsing: `output.replace(/\x1B\[[0-9;]*m/g, '')`
- Store original output with ANSI codes in terminal log

**Rationale**: 
Structured parsing enables YouBenchaLog normalization. Preserving raw output aids debugging.

**Parsing Strategy**:
```typescript
normalizeLog(result: AgentExecutionResult, context: AgentExecutionContext): YouBenchaLog {
  const cleanOutput = stripAnsiCodes(result.output);
  
  return {
    agent_info: {
      name: 'claude-code',
      version: extractVersion(cleanOutput),
      adapter_version: this.version,
    },
    model_info: {
      name: extractModel(cleanOutput, context.config.model),
      provider: 'anthropic',
    },
    execution: {
      started_at: result.startedAt,
      completed_at: result.completedAt,
      duration_ms: calculateDuration(result.startedAt, result.completedAt),
      exit_code: result.exitCode,
      status: result.status,
    },
    messages: parseMessages(cleanOutput),
    tool_calls: parseToolCalls(cleanOutput),
    usage: parseUsage(cleanOutput),
    errors: result.errors || [],
  };
}
```

---

### 4. Claude Code Rate Limiting and API Quotas

**Task**: Research rate limiting, API quotas, and retry strategies

**Findings**:
- Anthropic API has rate limits based on tier (free/pro/enterprise)
- Typical limits: 50 requests/min (free tier), 1000 requests/min (paid tier)
- Token limits per request: 200k tokens for Claude Sonnet 4
- Rate limit errors return HTTP 429 with `Retry-After` header
- Claude Code CLI may handle retries internally (unclear from docs)

**Decision**: 
- **Do NOT implement retry logic in adapter** - keep it simple and fail-fast
- If rate limit hit, Claude Code CLI will fail with exit code and error message
- Adapter captures error message and marks execution as "failed"
- Error message parsing: Detect "rate limit" or "429" in stderr → include in YouBenchaLog.errors
- Users can implement retry at orchestrator level if needed (future enhancement)

**Rationale**: 
Rate limiting is operational concern, not adapter concern. Failing fast with clear error enables users to diagnose and adjust evaluation timing. Matches constitution principle of keeping adapters focused.

**Implementation**:
```typescript
// In execute() error handling
if (stderr.includes('rate limit') || stderr.includes('429')) {
  errors.push({
    message: 'Claude Code API rate limit exceeded. Reduce evaluation frequency or upgrade API tier.',
    timestamp: new Date().toISOString(),
  });
}
```

---

## Best Practices Research

### Shell Escaping for Cross-Platform Execution

**Technology**: Node.js child_process with cross-platform shell support

**Best Practices**:
1. **Never use `shell: true`** with user input (command injection risk)
2. **Use argument arrays** with `spawn()` instead of string concatenation
3. **For unavoidable shell execution**: Use `shell-quote` library for escaping
4. **Platform-specific considerations**:
   - Windows PowerShell: Escape `$`, `"`, `` ` ``
   - Bash/Zsh: Escape `$`, `"`, `\`, `'`
   - Use double quotes for args with spaces
5. **Validation**: Reject prompts containing shell metacharacters unless properly escaped

**Implementation Pattern**:
```typescript
import { quote } from 'shell-quote';

buildSafeCommand(prompt: string): string[] {
  // Validate prompt doesn't contain dangerous patterns
  if (containsDangerousPatterns(prompt)) {
    throw new Error('Prompt contains shell metacharacters. Use prompt_file for complex prompts.');
  }
  
  // Use argument array (no shell interpretation)
  return ['claude', '-p', prompt]; // spawn will handle escaping
}

// For shell=true cases (avoid):
const escapedPrompt = quote([prompt]);
```

**Decision**: Use `spawn()` with argument arrays (shell=false). Avoids most escaping issues.

---

### Timeout Enforcement Patterns

**Technology**: Node.js child process timeout handling

**Best Practices**:
1. **Use AbortController** (Node.js 15+) for clean process termination
2. **Capture output before timeout**: Buffer stdout/stderr up to timeout point
3. **Grace period**: Send SIGTERM, wait 5s, then SIGKILL if necessary
4. **Cross-platform killing**: Use `tree-kill` library for Windows process tree termination

**Implementation Pattern**:
```typescript
async executeWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  const child = spawn(command, args, {
    cwd,
    signal: controller.signal,
    shell: false, // Critical: no shell injection
  });
  
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  
  try {
    await new Promise((resolve, reject) => {
      child.on('close', resolve);
      child.on('error', reject);
    });
    clearTimeout(timeoutId);
    return { output, exitCode: child.exitCode, timedOut: false };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { output, exitCode: -1, timedOut: true };
    }
    throw error;
  }
}
```

**Decision**: Use AbortController pattern matching copilot-cli.ts implementation.

---

### Output Size Limiting

**Technology**: Stream-based output capture with size limits

**Best Practices**:
1. **Monitor output size in real-time** during capture
2. **Stop capturing at threshold** (10MB per requirements)
3. **Append truncation marker** to output for clarity
4. **Don't kill process** - let it complete, just stop buffering
5. **Log original size** in metadata for analysis

**Implementation Pattern**:
```typescript
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

let output = '';
let outputSize = 0;
let truncated = false;

child.stdout.on('data', (data: Buffer) => {
  if (truncated) return;
  
  outputSize += data.length;
  if (outputSize > MAX_OUTPUT_SIZE) {
    const remaining = MAX_OUTPUT_SIZE - (outputSize - data.length);
    output += data.slice(0, remaining).toString();
    output += '\n\n[OUTPUT TRUNCATED: Exceeded 10MB limit]\n';
    truncated = true;
  } else {
    output += data.toString();
  }
});
```

**Decision**: Implement size limiting inline during output capture.

---

## Alternatives Considered

### Alternative 1: Use Claude API Directly Instead of CLI

**Description**: Call Anthropic API via SDK instead of wrapping CLI

**Pros**:
- More control over request/response format
- Easier parsing (JSON API responses)
- No CLI installation dependency

**Cons**:
- Doesn't evaluate Claude Code CLI tool (user's actual interface)
- Missing CLI-specific features (agents, permission modes, MCP tools)
- Requires API key management in adapter code
- Different behavior than what users experience with CLI

**Rejected Because**: 
Users want to evaluate Claude Code CLI specifically, not raw API. CLI provides agent workflows and tooling not available in API. Framework goal is to evaluate agents as users experience them.

---

### Alternative 2: Interactive Mode with Expect/Pexpect

**Description**: Use interactive mode and programmatically respond to prompts

**Pros**:
- Could handle permission prompts
- More realistic user interaction

**Cons**:
- Complex state machine for interaction handling
- Non-deterministic timing issues
- Hard to test and maintain
- Cross-platform compatibility challenges (Windows vs Unix expect)

**Rejected Because**: 
Non-interactive print mode (`-p`) is designed for automation. Adding interaction complexity violates simplicity principle. Permission modes can be configured via CLI flags.

---

### Alternative 3: Docker Container for Sandbox Isolation

**Description**: Run Claude Code CLI in Docker container for isolation

**Pros**:
- Stronger isolation
- Reproducible environment
- Network control

**Cons**:
- Docker dependency (not always available)
- Slower execution (container overhead)
- Complex setup (API key mounting, volume mapping)
- Constitution already requires workspace isolation (handled by orchestrator)

**Rejected Because**: 
Workspace isolation is orchestrator's responsibility per constitution. Adapter should remain simple. Docker support can be added later as orchestrator feature.

---

## Resolved Clarifications

| Original Question | Resolution | Impact on Design |
|-------------------|------------|------------------|
| Does Claude Code CLI require special authentication/API key setup? | Yes - requires `ANTHROPIC_API_KEY` env var or `claude auth` | checkAvailability() validates authentication |
| What is exact CLI command syntax for non-interactive execution? | `claude -p "prompt"` with optional flags | buildClaudeCommand() uses `-p` primary syntax |
| What output format does Claude Code produce? | Structured text with metadata, tool calls, usage stats | normalizeLog() uses regex parsing to extract YouBenchaLog fields |
| Does Claude Code have rate limiting considerations? | Yes - Anthropic API rate limits apply | Fail-fast with clear error; no retry logic in adapter |

---

## Technology Stack Confirmed

- **Language**: TypeScript 5.0+
- **Runtime**: Node.js 20+
- **Process Spawning**: child_process.spawn (shell=false)
- **Timeout**: AbortController API
- **Shell Escaping**: Argument arrays (no shell-quote needed if shell=false)
- **Output Parsing**: Regex + string manipulation
- **Schema Validation**: Zod (existing)
- **Testing**: Jest (existing)

---

## Open Questions for Implementation Phase

1. **Edge Case**: How does Claude Code handle extremely long prompts (>100k chars)? 
   - Test with large prompt, document limit if found
   
2. **Edge Case**: Does Claude Code respect CWD or need explicit `--directory`?
   - Integration test will verify; add flag if needed
   
3. **Feature**: Should adapter support streaming mode for long-running tasks?
   - Defer to future - keep MVP simple with buffered output
   
4. **Feature**: Should adapter capture intermediate tool execution outputs separately?
   - Defer to future - MVP captures combined output only

---

**Research Complete** | **Ready for Phase 1: Design**
