# Quick Start: Claude Code Adapter

**Feature**: Claude Code CLI integration for youBencha  
**Audience**: Developers implementing the adapter  
**Time to Complete**: 2-3 days for core implementation + 1 day testing

---

## Prerequisites

Before starting implementation:

✅ **Environment Setup**
- Node.js 20+ installed
- TypeScript 5.0+ configured
- Jest test framework set up
- youBencha codebase cloned and dependencies installed

✅ **Claude Code CLI**
- Claude Code CLI installed (`npm install -g @anthropic/claude-code`)
- Authenticated via `claude auth` or `ANTHROPIC_API_KEY` env var
- Verify with: `claude --version`

✅ **Knowledge**
- Familiar with AgentAdapter interface (`src/adapters/base.ts`)
- Reviewed copilot-cli.ts reference implementation
- Read youbenchalog.schema.ts for log format
- Understand constitution principles (especially TDD, security)

✅ **Documentation Read**
- [spec.md](./spec.md) - Feature requirements and user stories
- [research.md](./research.md) - Technical decisions and patterns
- [data-model.md](./data-model.md) - Entity definitions and validation
- [contracts/](./contracts/) - Interface contracts and test requirements

---

## Implementation Roadmap

### Phase 1: Contract Tests (Day 1 - Morning)

**TDD First**: Write tests before implementation per constitution

1. **Create test file**: `tests/contract/adapter.test.ts`
   - Add describe block for `ClaudeCodeAdapter`
   - Implement CR-1.x tests (checkAvailability)
   - Implement CR-3.x tests (normalizeLog) with mocks
   
2. **Create unit test file**: `tests/unit/claude-code-adapter.test.ts`
   - Implement CR-2.x tests (execute) with mocks
   - Test command building logic
   - Test output parsing helpers

3. **Run tests**: `npm test -- claude-code` → All should fail (red phase)

**Acceptance Criteria**:
- ✅ 20+ contract tests defined
- ✅ All tests fail with "not implemented" errors
- ✅ Test coverage plan documented

---

### Phase 2: Adapter Skeleton (Day 1 - Afternoon)

**Goal**: Implement minimal structure to pass interface checks

1. **Create adapter file**: `src/adapters/claude-code.ts`
   ```typescript
   import { AgentAdapter, AgentExecutionContext, AgentExecutionResult } from './base.js';
   import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
   
   export class ClaudeCodeAdapter implements AgentAdapter {
     readonly name = 'claude-code';
     readonly version = '1.0.0';
     
     async checkAvailability(): Promise<boolean> {
       // TODO: Implement
       throw new Error('Not implemented');
     }
     
     async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
       // TODO: Implement
       throw new Error('Not implemented');
     }
     
     normalizeLog(result: AgentExecutionResult, context: AgentExecutionContext): YouBenchaLog {
       // TODO: Implement
       throw new Error('Not implemented');
     }
   }
   ```

2. **Register adapter**: Edit `src/core/orchestrator.ts`
   ```typescript
   function getAgentAdapter(type: string): AgentAdapter {
     switch (type) {
       case 'copilot-cli':
         return new CopilotCLIAdapter();
       case 'claude-code':
         return new ClaudeCodeAdapter();  // ADD THIS
       default:
         throw new Error(`Unknown agent type: ${type}`);
     }
   }
   ```

3. **Run tests**: Some interface tests should now pass

**Acceptance Criteria**:
- ✅ Adapter class exists and compiles
- ✅ Implements AgentAdapter interface
- ✅ Registered in orchestrator
- ✅ Basic import tests pass

---

### Phase 3: checkAvailability Implementation (Day 1 - Late)

**Goal**: Detect Claude Code CLI and authentication

1. **Implement CLI detection**:
   ```typescript
   import { promisify } from 'util';
   import { exec } from 'child_process';
   const execAsync = promisify(exec);
   
   async checkAvailability(): Promise<boolean> {
     try {
       const command = process.platform === 'win32' 
         ? 'where claude' 
         : 'which claude';
       await execAsync(command);
       
       // Verify authentication
       await execAsync('claude --version');
       return true;
     } catch (error) {
       if (error.message.includes('auth') || error.message.includes('API key')) {
         throw new Error(
           'Claude Code requires authentication. Run "claude auth" or set ANTHROPIC_API_KEY.'
         );
       }
       return false;
     }
   }
   ```

2. **Run contract tests**: CR-1.x tests should pass

**Acceptance Criteria**:
- ✅ Returns true when CLI installed and authenticated
- ✅ Returns false when CLI not found
- ✅ Throws auth error with clear message
- ✅ Works on Windows/macOS/Linux

---

### Phase 4: Command Building (Day 2 - Morning)

**Goal**: Build correct CLI command from context

1. **Implement buildClaudeCommand helper**:
   ```typescript
   private buildClaudeCommand(
     context: AgentExecutionContext
   ): { command: string; args: string[] } {
     const config = context.config;
     const args: string[] = ['-p'];
     
     // Handle prompt vs prompt_file
     if (config.prompt_file) {
       const promptPath = path.join(context.workspaceDir, config.prompt_file as string);
       const promptContent = readFileSync(promptPath, 'utf-8');
       args.push(promptContent);
     } else {
       args.push(config.prompt as string);
     }
     
     // Add optional parameters
     if (config.model) {
       args.push('--model', config.model as string);
     }
     if (context.config.agent_name) {
       args.push('--agents', context.config.agent_name as string);
     }
     
     return { command: 'claude', args };
   }
   ```

2. **Write unit tests** for command building variations

**Acceptance Criteria**:
- ✅ Generates correct args for prompt
- ✅ Handles prompt_file correctly
- ✅ Adds model flag when specified
- ✅ Adds agent_name flag when specified
- ✅ Unit tests pass

---

### Phase 5: Execute Implementation (Day 2 - Afternoon)

**Goal**: Run Claude Code and capture output

1. **Implement executeWithTimeout helper** (copy pattern from copilot-cli.ts):
   ```typescript
   private async executeWithTimeout(
     command: string,
     args: string[],
     cwd: string,
     env: Record<string, string>,
     timeout: number,
     terminalLogPath: string
   ): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
     return new Promise((resolve, reject) => {
       const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
       let output = '';
       let outputSize = 0;
       let truncated = false;
       
       const child = spawn(command, args, {
         cwd,
         env: { ...process.env, ...env },
         shell: false,  // Security: no shell injection
       });
       
       const logStream = createWriteStream(terminalLogPath);
       
       // Capture stdout with size limiting
       child.stdout.on('data', (data: Buffer) => {
         logStream.write(data);
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
       
       child.stderr.on('data', (data: Buffer) => {
         logStream.write(data);
         if (!truncated) output += data.toString();
       });
       
       // Timeout handling
       const timeoutId = timeout > 0 
         ? setTimeout(() => {
             child.kill('SIGTERM');
             setTimeout(() => child.kill('SIGKILL'), 5000);
           }, timeout)
         : null;
       
       child.on('close', (exitCode) => {
         if (timeoutId) clearTimeout(timeoutId);
         logStream.end();
         resolve({
           output,
           exitCode: exitCode || 0,
           timedOut: false,
         });
       });
       
       child.on('error', reject);
     });
   }
   ```

2. **Implement main execute method**:
   ```typescript
   async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
     const startedAt = new Date().toISOString();
     const errors: Array<{ message: string; timestamp: string }> = [];
     
     // Create log directory
     const logsDir = path.join(context.artifactsDir, 'claude-code-logs');
     await fs.mkdir(logsDir, { recursive: true });
     
     const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
     const terminalLogPath = path.join(logsDir, `terminal-output-${timestamp}.log`);
     
     // Build command
     const { command, args } = this.buildClaudeCommand(context);
     
     // Execute with timeout
     const result = await this.executeWithTimeout(
       command,
       args,
       context.workspaceDir,
       context.env,
       context.timeout,
       terminalLogPath
     );
     
     const completedAt = new Date().toISOString();
     
     // Determine status
     let status: 'success' | 'failed' | 'timeout' = 'success';
     if (result.timedOut) {
       status = 'timeout';
       errors.push({
         message: `Execution timed out after ${context.timeout}ms`,
         timestamp: new Date().toISOString(),
       });
     } else if (result.exitCode !== 0) {
       status = 'failed';
     }
     
     return {
       exitCode: result.exitCode,
       status,
       output: result.output,
       startedAt,
       completedAt,
       errors,
     };
   }
   ```

3. **Run integration tests**

**Acceptance Criteria**:
- ✅ Executes Claude Code successfully
- ✅ Captures full output
- ✅ Enforces timeout correctly
- ✅ Limits output to 10MB
- ✅ Creates terminal log file
- ✅ CR-2.x tests pass

---

### Phase 6: Log Normalization (Day 3 - Morning)

**Goal**: Parse output and create YouBenchaLog

1. **Implement parsing helpers**:
   ```typescript
   private stripAnsiCodes(text: string): string {
     return text.replace(/\x1B\[[0-9;]*m/g, '');
   }
   
   private extractModel(output: string, configModel?: string): string {
     const match = output.match(/Model:\s+([\w\-\.]+)/i);
     return match?.[1] || configModel || 'unknown';
   }
   
   private extractVersion(output: string): string {
     const match = output.match(/Claude Code (?:CLI )?v?([\d\.]+)/i);
     return match?.[1] || 'unknown';
   }
   
   private parseUsage(output: string): { input_tokens: number; output_tokens: number; total_tokens: number } | undefined {
     const inputMatch = output.match(/Input tokens:\s+(\d+)/i);
     const outputMatch = output.match(/Output tokens:\s+(\d+)/i);
     
     if (!inputMatch || !outputMatch) return undefined;
     
     const input_tokens = parseInt(inputMatch[1], 10);
     const output_tokens = parseInt(outputMatch[1], 10);
     
     return {
       input_tokens,
       output_tokens,
       total_tokens: input_tokens + output_tokens,
     };
   }
   
   private parseToolCalls(output: string): Array<{ name: string; arguments: string }> {
     const toolCalls: Array<{ name: string; arguments: string }> = [];
     const regex = /\[TOOL:\s+(\w+)\]\s*([^\n]+)?/gi;
     let match;
     
     while ((match = regex.exec(output)) !== null) {
       toolCalls.push({
         name: match[1],
         arguments: match[2]?.trim() || '',
       });
     }
     
     return toolCalls;
   }
   ```

2. **Implement normalizeLog**:
   ```typescript
   normalizeLog(
     result: AgentExecutionResult,
     context: AgentExecutionContext
   ): YouBenchaLog {
     const cleanOutput = this.stripAnsiCodes(result.output);
     
     return {
       agent_info: {
         name: this.name,
         version: this.extractVersion(cleanOutput),
         adapter_version: this.version,
       },
       model_info: {
         name: this.extractModel(cleanOutput, context.config.model as string),
         provider: 'anthropic',
       },
       execution: {
         started_at: result.startedAt,
         completed_at: result.completedAt,
         duration_ms: new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime(),
         exit_code: result.exitCode,
         status: result.status,
       },
       messages: [], // TODO: Implement message parsing if needed
       tool_calls: this.parseToolCalls(cleanOutput),
       usage: this.parseUsage(cleanOutput),
       errors: result.errors,
     };
   }
   ```

3. **Run contract tests**: CR-3.x tests should pass

**Acceptance Criteria**:
- ✅ Produces valid YouBenchaLog
- ✅ Extracts model and version
- ✅ Parses usage statistics
- ✅ Parses tool calls
- ✅ Strips ANSI codes
- ✅ All normalization tests pass

---

### Phase 7: Integration Testing (Day 3 - Afternoon)

**Goal**: End-to-end validation

1. **Create example test case**: `examples/testcase-claude-code.yaml`
   ```yaml
   repo: https://github.com/youbencha/test-repo.git
   branch: main
   agent:
     type: claude-code
     config:
       prompt: "Add a README.md file with project description"
   evaluators:
     - git-diff
   ```

2. **Run end-to-end test**:
   ```bash
   npm run build
   node dist/cli/index.js run -c examples/testcase-claude-code.yaml
   ```

3. **Verify outputs**:
   - Workspace created in `.youbencha-workspace/`
   - Claude Code executed
   - `youbencha-log.json` created in artifacts
   - Evaluators ran successfully
   - Results bundle generated

4. **Create integration test**: `tests/integration/claude-code-e2e.test.ts`

**Acceptance Criteria**:
- ✅ Full evaluation completes successfully
- ✅ Log validates against schema
- ✅ Evaluators can consume log
- ✅ CR-4.x tests pass
- ✅ Example test case works

---

### Phase 8: Documentation & Examples (Day 4)

**Goal**: User-facing documentation

1. **Create example files**:
   - `examples/testcase-claude-code.yaml` (basic)
   - `examples/testcase-claude-code-advanced.yaml` (all options)

2. **Update README.md**: Add Claude Code to supported agents

3. **Update orchestrator.ts**: Ensure switch includes claude-code

4. **Security review**: Run security test suite (if exists)

**Acceptance Criteria**:
- ✅ 2+ example configurations
- ✅ Documentation complete
- ✅ Code review ready

---

## Testing Checklist

Before submitting implementation:

- [ ] All contract tests pass (20+ tests)
- [ ] Unit test coverage ≥80%
- [ ] Integration test passes end-to-end
- [ ] Manual testing on Windows completed
- [ ] Manual testing on macOS/Linux completed
- [ ] Example test cases run successfully
- [ ] No console errors or warnings
- [ ] youbencha-log.json validates against schema
- [ ] Security tests pass (no shell injection)
- [ ] Memory leak test passes (100 iterations)

---

## Common Issues & Solutions

### Issue: "claude: command not found"
**Solution**: Install Claude Code CLI globally:
```bash
npm install -g @anthropic/claude-code
```

### Issue: "Authentication required"
**Solution**: Run `claude auth` or set API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Issue: Timeout in tests
**Solution**: Increase timeout or mock Claude Code execution:
```typescript
jest.setTimeout(60000); // 60 seconds
```

### Issue: Output parsing failures
**Solution**: Check Claude Code version compatibility:
```bash
claude --version  # Should be 1.x or 2.x
```

### Issue: Tests fail on Windows
**Solution**: Check path separators and shell commands:
```typescript
const command = process.platform === 'win32' ? 'where' : 'which';
```

---

## Next Steps After Implementation

1. **Code Review**: Submit PR with implementation
2. **Documentation**: Update main README with Claude Code instructions
3. **Examples**: Add to examples directory
4. **Announcement**: Document in changelog/release notes
5. **User Testing**: Get feedback from early adopters
6. **Iteration**: Address edge cases and feature requests

---

## Resources

- **Reference Implementation**: `src/adapters/copilot-cli.ts`
- **Interface Definition**: `src/adapters/base.ts`
- **Schema**: `src/schemas/youbenchalog.schema.ts`
- **Constitution**: `.specify/memory/constitution.md`
- **Claude Code Docs**: https://docs.anthropic.com/claude-code

---

**Quick Start Complete** | **Ready for Implementation**
