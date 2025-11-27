# AgentAdapter Contract: Claude Code

**Interface**: `AgentAdapter` from `src/adapters/base.ts`  
**Implementation**: `ClaudeCodeAdapter` in `src/adapters/claude-code.ts`

## Contract Overview

This contract defines the behavior requirements for the Claude Code adapter implementation. All contract tests must pass before implementation is considered complete.

---

## Method: `checkAvailability()`

**Signature**:
```typescript
checkAvailability(): Promise<boolean>
```

**Contract Requirements**:

### CR-1.1: CLI Detection
**Given** Claude Code CLI is installed and in PATH  
**When** `checkAvailability()` is called  
**Then** Promise resolves to `true`

### CR-1.2: CLI Missing
**Given** Claude Code CLI is NOT installed or not in PATH  
**When** `checkAvailability()` is called  
**Then** Promise resolves to `false` (does not throw)

### CR-1.3: Authentication Detection
**Given** Claude Code CLI is installed but not authenticated  
**When** `checkAvailability()` is called  
**Then** Promise throws Error with message containing "authentication" or "API key"

### CR-1.4: Version Check
**Given** Claude Code CLI returns version information  
**When** `checkAvailability()` is called  
**Then** No errors are thrown if version is valid

### CR-1.5: Cross-Platform
**Given** Tests run on Windows, macOS, or Linux  
**When** `checkAvailability()` is called  
**Then** Behavior is consistent (uses platform-appropriate commands)

**Test Implementation** (`tests/contract/adapter.test.ts`):
```typescript
describe('ClaudeCodeAdapter.checkAvailability()', () => {
  it('returns true when CLI is installed', async () => {
    const adapter = new ClaudeCodeAdapter();
    const available = await adapter.checkAvailability();
    expect(available).toBe(true);
  });
  
  it('returns false when CLI is not found', async () => {
    // Mock execAsync to simulate command not found
    jest.mock('child_process');
    const adapter = new ClaudeCodeAdapter();
    const available = await adapter.checkAvailability();
    expect(available).toBe(false);
  });
  
  it('throws clear error when not authenticated', async () => {
    // Mock execAsync to return auth error
    const adapter = new ClaudeCodeAdapter();
    await expect(adapter.checkAvailability()).rejects.toThrow(/auth|API key/i);
  });
});
```

---

## Method: `execute(context: AgentExecutionContext)`

**Signature**:
```typescript
execute(context: AgentExecutionContext): Promise<AgentExecutionResult>
```

**Contract Requirements**:

### CR-2.1: Successful Execution
**Given** Valid context with prompt and workspace  
**When** `execute()` is called and Claude Code succeeds (exit 0)  
**Then** Promise resolves with:
- `status: 'success'`
- `exitCode: 0`
- `output` containing captured stdout/stderr
- Valid ISO 8601 timestamps

### CR-2.2: Failed Execution
**Given** Valid context  
**When** Claude Code exits with non-zero code  
**Then** Promise resolves (not rejects) with:
- `status: 'failed'`
- `exitCode` matching actual exit code
- `output` containing error messages
- `errors` array populated with error details

### CR-2.3: Timeout Enforcement
**Given** Context with `timeout: 5000` (5 seconds)  
**When** Claude Code execution exceeds 5 seconds  
**Then** Promise resolves with:
- `status: 'timeout'`
- `exitCode: -1` or process-specific timeout code
- `output` containing partial output captured before timeout
- `errors` array containing timeout error with duration

### CR-2.4: Prompt Configuration
**Given** Context with `config.prompt: "List files"`  
**When** `execute()` is called  
**Then** Claude Code CLI is invoked with `-p "List files"`

### CR-2.5: Prompt File Configuration
**Given** Context with `config.prompt_file: "./prompts/task.md"`  
**When** `execute()` is called  
**Then** Prompt file is read and contents passed to Claude Code

### CR-2.6: Model Parameter
**Given** Context with `config.model: "claude-sonnet-4-5-20250929"`  
**When** `execute()` is called  
**Then** CLI invoked with `--model claude-sonnet-4-5-20250929`

### CR-2.7: Agent Name Parameter
**Given** Context with `config.agent_name: "code-reviewer"`  
**When** `execute()` is called  
**Then** CLI invoked with `--agents code-reviewer`

### CR-2.8: Output Capture Completeness
**Given** Claude Code produces 1KB of output  
**When** `execute()` is called  
**Then** All output is captured in `result.output` (no truncation)

### CR-2.9: Output Size Limiting
**Given** Claude Code produces 15MB of output  
**When** `execute()` is called  
**Then** 
- Output captured up to 10MB
- Remaining output discarded
- Result contains truncation marker
- `errors` includes truncation error

### CR-2.10: Working Directory
**Given** Context with `workspaceDir: "/path/to/workspace"`  
**When** `execute()` is called  
**Then** Claude Code process spawned with CWD set to workspace path

### CR-2.11: Environment Variables
**Given** Context with `env: { ANTHROPIC_API_KEY: "sk-..." }`  
**When** `execute()` is called  
**Then** Environment variables passed to spawned process

### CR-2.12: Terminal Log Creation
**Given** Valid execution context  
**When** `execute()` is called  
**Then** Raw output saved to `artifactsDir/claude-code-logs/terminal-output-{timestamp}.log`

### CR-2.13: Special Characters in Prompt
**Given** Context with prompt containing quotes, backticks, dollar signs  
**When** `execute()` is called  
**Then** Prompt correctly escaped and passed to CLI without errors

**Test Implementation** (`tests/unit/claude-code-adapter.test.ts`):
```typescript
describe('ClaudeCodeAdapter.execute()', () => {
  const mockContext: AgentExecutionContext = {
    workspaceDir: '/tmp/test-workspace',
    repoDir: '/tmp/test-workspace/src-modified',
    artifactsDir: '/tmp/test-artifacts',
    config: { prompt: 'Test prompt' },
    timeout: 30000,
    env: { ANTHROPIC_API_KEY: 'test-key' },
  };
  
  it('executes successfully and returns success status', async () => {
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.execute(mockContext);
    
    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeDefined();
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  
  it('handles timeout correctly', async () => {
    const shortTimeoutContext = { ...mockContext, timeout: 100 };
    const adapter = new ClaudeCodeAdapter();
    
    // This assumes Claude Code takes >100ms
    const result = await adapter.execute(shortTimeoutContext);
    
    expect(result.status).toBe('timeout');
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('timeout') })
    );
  });
  
  it('enforces 10MB output limit', async () => {
    // Mock spawn to produce large output
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.execute(mockContext);
    
    if (result.output.length > 10 * 1024 * 1024) {
      expect(result.output).toContain('[OUTPUT TRUNCATED');
      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('truncated') })
      );
    }
  });
});
```

---

## Method: `normalizeLog(result, context)`

**Signature**:
```typescript
normalizeLog(result: AgentExecutionResult, context: AgentExecutionContext): YouBenchaLog
```

**Contract Requirements**:

### CR-3.1: Schema Compliance
**Given** Any valid `AgentExecutionResult`  
**When** `normalizeLog()` is called  
**Then** Returned object validates against `youbenchalog.schema.ts`

### CR-3.2: Agent Info Population
**Given** Execution result  
**When** `normalizeLog()` is called  
**Then** `agent_info.name` is 'claude-code'  
**And** `agent_info.version` is extracted from output or 'unknown'  
**And** `agent_info.adapter_version` matches adapter version

### CR-3.3: Model Info Population
**Given** Execution result with model in output  
**When** `normalizeLog()` is called  
**Then** `model_info.name` is extracted model name  
**And** `model_info.provider` is 'anthropic'

### CR-3.4: Model Info Fallback
**Given** Execution result without model in output but `context.config.model` present  
**When** `normalizeLog()` is called  
**Then** `model_info.name` is taken from config

### CR-3.5: Execution Metadata
**Given** Execution result with timestamps  
**When** `normalizeLog()` is called  
**Then** `execution.started_at`, `execution.completed_at`, `execution.duration_ms` match result  
**And** `execution.exit_code` matches result  
**And** `execution.status` matches result

### CR-3.6: Message Parsing
**Given** Claude Code output with structured messages  
**When** `normalizeLog()` is called  
**Then** `messages` array contains parsed messages with role and content

### CR-3.7: Tool Call Parsing
**Given** Claude Code output with `[TOOL: read_file] path/to/file`  
**When** `normalizeLog()` is called  
**Then** `tool_calls` array contains entry with `name: 'read_file'` and `arguments: 'path/to/file'`

### CR-3.8: Usage Parsing
**Given** Output contains "Input tokens: 1234" and "Output tokens: 5678"  
**When** `normalizeLog()` is called  
**Then** `usage.input_tokens: 1234`, `usage.output_tokens: 5678`, `usage.total_tokens: 6912`

### CR-3.9: ANSI Code Stripping
**Given** Output contains ANSI color codes  
**When** `normalizeLog()` is called  
**Then** Messages and content have ANSI codes removed

### CR-3.10: Error Propagation
**Given** Execution result with errors  
**When** `normalizeLog()` is called  
**Then** `errors` array includes all errors from result

### CR-3.11: Truncation Recording
**Given** Execution result with truncated output  
**When** `normalizeLog()` is called  
**Then** `errors` array includes truncation error  
**And** Error message indicates 10MB limit

**Test Implementation** (`tests/contract/adapter.test.ts`):
```typescript
describe('ClaudeCodeAdapter.normalizeLog()', () => {
  const mockResult: AgentExecutionResult = {
    exitCode: 0,
    status: 'success',
    output: 'Model: claude-sonnet-4\nInput tokens: 100\nOutput tokens: 200\n[TOOL: read_file] test.ts',
    startedAt: '2025-11-25T10:00:00Z',
    completedAt: '2025-11-25T10:01:00Z',
    errors: [],
  };
  
  const mockContext: AgentExecutionContext = {
    workspaceDir: '/tmp/test',
    repoDir: '/tmp/test/src-modified',
    artifactsDir: '/tmp/artifacts',
    config: { prompt: 'Test' },
    timeout: 30000,
    env: {},
  };
  
  it('produces valid YouBenchaLog', async () => {
    const adapter = new ClaudeCodeAdapter();
    const log = adapter.normalizeLog(mockResult, mockContext);
    
    // Validate against Zod schema
    const validation = YouBenchaLogSchema.safeParse(log);
    expect(validation.success).toBe(true);
  });
  
  it('extracts model name from output', () => {
    const adapter = new ClaudeCodeAdapter();
    const log = adapter.normalizeLog(mockResult, mockContext);
    
    expect(log.model_info.name).toBe('claude-sonnet-4');
    expect(log.model_info.provider).toBe('anthropic');
  });
  
  it('parses usage statistics', () => {
    const adapter = new ClaudeCodeAdapter();
    const log = adapter.normalizeLog(mockResult, mockContext);
    
    expect(log.usage?.input_tokens).toBe(100);
    expect(log.usage?.output_tokens).toBe(200);
    expect(log.usage?.total_tokens).toBe(300);
  });
  
  it('parses tool calls', () => {
    const adapter = new ClaudeCodeAdapter();
    const log = adapter.normalizeLog(mockResult, mockContext);
    
    expect(log.tool_calls).toContainEqual(
      expect.objectContaining({
        name: 'read_file',
        arguments: expect.stringContaining('test.ts'),
      })
    );
  });
});
```

---

## Integration Contract: End-to-End

### CR-4.1: Full Evaluation Workflow
**Given** Test case with `agent.type: claude-code` and valid config  
**When** `yb run -c testcase.yaml` is executed  
**Then**:
1. Adapter availability checked
2. Claude Code executed in workspace
3. Output captured completely
4. youbencha-log.json created in artifacts
5. Log validates against schema
6. Evaluators run successfully with log as input

### CR-4.2: Cross-Agent Compatibility
**Given** Two test cases: one with copilot-cli, one with claude-code  
**When** Both executed with same evaluators  
**Then** Both produce valid YouBenchaLog with comparable structure

**Test Implementation** (`tests/integration/claude-code-e2e.test.ts`):
```typescript
describe('Claude Code End-to-End', () => {
  it('completes full evaluation workflow', async () => {
    const suiteConfig = {
      repo: 'https://github.com/test/repo.git',
      branch: 'main',
      agent: {
        type: 'claude-code',
        config: {
          prompt: 'Add a README file',
        },
      },
      evaluators: ['git-diff'],
    };
    
    const orchestrator = new Orchestrator(suiteConfig);
    const results = await orchestrator.run();
    
    expect(results.agent_execution.status).toMatch(/success|failed/);
    expect(results.youbencha_log).toBeDefined();
    expect(results.evaluator_results.length).toBeGreaterThan(0);
  });
});
```

---

## Non-Functional Contract Requirements

### NFR-1: Performance
- Adapter overhead < 500ms per execution
- Log normalization < 100ms for typical output (1MB)
- Memory usage < 50MB excluding output buffering

### NFR-2: Reliability
- No memory leaks over 100 consecutive executions
- Proper cleanup of file handles and child processes
- Timeout enforcement accurate within 5 seconds

### NFR-3: Security
- No shell injection vulnerabilities (validated by security test suite)
- Path traversal protection (rejects `..` in prompt_file)
- Output size limiting prevents DoS

### NFR-4: Maintainability
- Code coverage ≥ 80% for adapter module
- All public methods have JSDoc comments
- Error messages are actionable (include fix suggestions)

---

**Contract Document Complete** | **Ready for Implementation**
