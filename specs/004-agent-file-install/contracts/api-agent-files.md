# API Contract: Agent Files Module

**Feature**: 004-agent-file-install  
**Date**: 2025-11-30

## Module: `src/lib/agent-files.ts`

### Function: `installAgentFiles`

Installs all registered agent files to the target directory.

```typescript
/**
 * Install agent files to the specified target directory
 * 
 * @param options - Installation options
 * @returns Promise resolving to installation results
 * 
 * @example
 * // Install with defaults (cwd, no force)
 * const result = await installAgentFiles();
 * 
 * @example
 * // Install with force overwrite
 * const result = await installAgentFiles({ force: true });
 * 
 * @example
 * // Install to specific directory
 * const result = await installAgentFiles({ targetDir: '/path/to/project' });
 */
export async function installAgentFiles(
  options?: InstallAgentsOptions
): Promise<InstallAgentsResult>;
```

**Preconditions**:
- `options.targetDir` (if provided) must be an absolute path
- Process must have write access to target directory

**Postconditions**:
- All agent files attempted (partial success possible)
- `result.success` is `true` only if all files succeeded
- Directory structure created if needed

**Side Effects**:
- Creates directories: `.github/agents/`, `.claude/agents/`
- Creates/overwrites files based on `force` option

### Function: `getAgentFiles`

Returns the list of agent files that would be installed.

```typescript
/**
 * Get the list of agent files available for installation
 * 
 * @returns Array of agent file definitions
 * 
 * @example
 * const files = getAgentFiles();
 * console.log(files.length); // 2
 * console.log(files[0].relativePath); // ".github/agents/agentic-judge.md"
 */
export function getAgentFiles(): readonly AgentFileDefinition[];
```

**Preconditions**: None

**Postconditions**:
- Returns immutable array
- Always returns at least 2 files (github + claude)

**Side Effects**: None

## Module: `src/agents/agentic-judge.ts`

### Constant: `GITHUB_AGENTIC_JUDGE_CONTENT`

```typescript
/**
 * Content of the GitHub Copilot CLI agentic-judge agent file
 * 
 * This is the source of truth for .github/agents/agentic-judge.md
 */
export const GITHUB_AGENTIC_JUDGE_CONTENT: string;
```

### Constant: `CLAUDE_AGENTIC_JUDGE_CONTENT`

```typescript
/**
 * Content of the Claude Code agentic-judge agent file
 * 
 * This is the source of truth for .claude/agents/agentic-judge.md
 */
export const CLAUDE_AGENTIC_JUDGE_CONTENT: string;
```

## Types

### InstallAgentsOptions

```typescript
interface InstallAgentsOptions {
  /**
   * Overwrite existing files
   * @default false
   */
  force?: boolean;
  
  /**
   * Target directory for installation
   * @default process.cwd()
   */
  targetDir?: string;
}
```

### InstallResult

```typescript
interface InstallResult {
  /** Relative file path that was processed */
  file: string;
  
  /** Operation result */
  status: 'created' | 'skipped' | 'overwritten' | 'error';
  
  /** Error message (only when status === 'error') */
  error?: string;
}
```

### InstallAgentsResult

```typescript
interface InstallAgentsResult {
  /** Individual file results */
  files: InstallResult[];
  
  /** Counts by status */
  summary: {
    created: number;
    skipped: number;
    overwritten: number;
    errors: number;
  };
  
  /** True if no errors occurred */
  success: boolean;
}
```

### AgentFileDefinition

```typescript
interface AgentFileDefinition {
  /** Relative path from installation root */
  relativePath: string;
  
  /** File content */
  content: string;
  
  /** Human-readable name for display */
  description: string;
}
```

## Error Handling

The function catches filesystem errors and maps them to user-friendly messages:

| Error Code | `InstallResult.error` |
|------------|----------------------|
| `EACCES` | "Permission denied. Check directory write permissions." |
| `ENOSPC` | "Disk full. Free up space and try again." |
| `EROFS` | "Read-only filesystem. Cannot write agent files." |
| Other | Original error message |

The function never throws - all errors are captured in `InstallResult.status === 'error'`.

## Integration Points

### Modified: `src/cli/commands/init.ts`

```typescript
// Add after testcase.yaml creation
import { installAgentFiles } from '../../lib/agent-files.js';

// In initCommand function:
const agentResult = await installAgentFiles({ force: options.force });
// Display results...
```

### New: `src/cli/commands/install-agents.ts`

```typescript
import { installAgentFiles } from '../../lib/agent-files.js';

export async function installAgentsCommand(options: { force?: boolean }): Promise<void> {
  const result = await installAgentFiles({ force: options.force });
  // Display results and exit...
}
```

### Modified: `src/cli/index.ts`

```typescript
import { installAgentsCommand } from './commands/install-agents.js';

// Register command
program
  .command('install-agents')
  .description('Install agentic-judge agent files for GitHub Copilot CLI and Claude Code')
  .option('--force', 'Overwrite existing agent files')
  .action(installAgentsCommand);
```
