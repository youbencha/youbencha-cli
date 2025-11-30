# Data Model: Agent File Installation

**Feature**: 004-agent-file-install  
**Date**: 2025-11-30  
**Status**: Complete

## Entities

### AgentFileDefinition

Represents a single agent file to be installed.

```typescript
/**
 * Definition of an agent file that can be installed
 */
interface AgentFileDefinition {
  /** Relative path from target directory (e.g., ".github/agents/agentic-judge.md") */
  relativePath: string;
  
  /** Agent file content as string */
  content: string;
  
  /** Human-readable description for CLI output */
  description: string;
}
```

**Validation Rules**:
- `relativePath` must not start with `/` or contain `..`
- `relativePath` must end with `.md`
- `content` must not be empty
- `description` must not be empty

### InstallResult

Result of installing a single agent file.

```typescript
/**
 * Result of attempting to install an agent file
 */
interface InstallResult {
  /** The file path that was processed */
  file: string;
  
  /** What happened to the file */
  status: 'created' | 'skipped' | 'overwritten' | 'error';
  
  /** Error message if status is 'error' */
  error?: string;
}
```

**State Transitions**:
- `created`: File did not exist → file now exists
- `skipped`: File existed → no change (without `--force`)
- `overwritten`: File existed + `--force` → file replaced
- `error`: Operation failed → original state preserved

### InstallAgentsOptions

Options for the installation function.

```typescript
/**
 * Options for agent file installation
 */
interface InstallAgentsOptions {
  /** Overwrite existing files if true */
  force?: boolean;
  
  /** Target directory (defaults to process.cwd()) */
  targetDir?: string;
}
```

### InstallAgentsResult

Aggregate result from installing all agent files.

```typescript
/**
 * Complete result of install-agents operation
 */
interface InstallAgentsResult {
  /** Results for each agent file */
  files: InstallResult[];
  
  /** Summary counts */
  summary: {
    created: number;
    skipped: number;
    overwritten: number;
    errors: number;
  };
  
  /** Overall success (true if no errors) */
  success: boolean;
}
```

## Constants

### AGENT_FILES

Registry of all agent files to install.

```typescript
/**
 * All agent files that should be installed
 */
const AGENT_FILES: AgentFileDefinition[] = [
  {
    relativePath: '.github/agents/agentic-judge.md',
    content: GITHUB_AGENTIC_JUDGE_CONTENT,
    description: 'GitHub Copilot CLI agentic-judge agent'
  },
  {
    relativePath: '.claude/agents/agentic-judge.md', 
    content: CLAUDE_AGENTIC_JUDGE_CONTENT,
    description: 'Claude Code agentic-judge agent'
  }
];
```

## Relationships

```
┌──────────────────┐
│ InstallAgentsCmd │
└────────┬─────────┘
         │ calls
         ▼
┌──────────────────────┐
│ installAgentFiles()  │
└────────┬─────────────┘
         │ iterates
         ▼
┌──────────────────────┐
│ AGENT_FILES registry │──────► AgentFileDefinition[]
└────────┬─────────────┘
         │ for each
         ▼
┌──────────────────────┐
│ installSingleFile()  │──────► InstallResult
└──────────────────────┘
         │
         │ aggregates to
         ▼
┌──────────────────────┐
│ InstallAgentsResult  │
└──────────────────────┘
```

## File Locations

| Entity | Module |
|--------|--------|
| `AgentFileDefinition` | `src/lib/agent-files.ts` |
| `InstallResult` | `src/lib/agent-files.ts` |
| `InstallAgentsOptions` | `src/lib/agent-files.ts` |
| `InstallAgentsResult` | `src/lib/agent-files.ts` |
| `AGENT_FILES` | `src/lib/agent-files.ts` |
| `GITHUB_AGENTIC_JUDGE_CONTENT` | `src/agents/agentic-judge.ts` |
| `CLAUDE_AGENTIC_JUDGE_CONTENT` | `src/agents/agentic-judge.ts` |

## Usage Examples

### From init.ts

```typescript
import { installAgentFiles } from '../lib/agent-files.js';

// After creating testcase.yaml...
const result = await installAgentFiles({ force: options.force });
for (const file of result.files) {
  if (file.status === 'created') {
    logger.info(`✓ Created ${file.file}`);
  } else if (file.status === 'skipped') {
    logger.info(`- Skipped ${file.file} (already exists)`);
  }
}
```

### From install-agents.ts

```typescript
import { installAgentFiles } from '../lib/agent-files.js';

export async function installAgentsCommand(options: { force?: boolean }): Promise<void> {
  const result = await installAgentFiles({ force: options.force });
  
  // Report results
  for (const file of result.files) {
    // ... display status
  }
  
  process.exit(result.success ? 0 : 1);
}
```
