# CLI Contract: install-agents Command

**Feature**: 004-agent-file-install  
**Date**: 2025-11-30

## Command Signature

```bash
yb install-agents [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--force` | boolean | `false` | Overwrite existing agent files |
| `--help` | boolean | - | Show help text |

## Behavior

### Default (no flags)

1. Check for each agent file location
2. If file exists: skip and report
3. If file does not exist: create and report
4. Exit 0 if all operations succeeded

### With --force

1. Create parent directories if needed
2. Write all agent files (overwrite existing)
3. Report each file as "overwritten" or "created"
4. Exit 0 if all operations succeeded

## Output Format

### Success - Files Created

```
Installing agent files...

✓ Created .github/agents/agentic-judge.md
✓ Created .claude/agents/agentic-judge.md

✨ Agent files installed successfully!

These files enable the agentic-judge evaluator to work with:
  - GitHub Copilot CLI
  - Claude Code

```

### Success - Files Skipped

```
Installing agent files...

- Skipped .github/agents/agentic-judge.md (already exists)
- Skipped .claude/agents/agentic-judge.md (already exists)

ℹ️  Agent files already exist. Use --force to overwrite.

```

### Success - Mixed (Some Exist, Some Created)

```
Installing agent files...

- Skipped .github/agents/agentic-judge.md (already exists)
✓ Created .claude/agents/agentic-judge.md

✨ Agent files installed successfully!
ℹ️  1 file skipped (use --force to overwrite)

```

### Success - Files Overwritten

```
Installing agent files...

⚠️  Overwriting existing agent files (--force flag used)

✓ Overwritten .github/agents/agentic-judge.md
✓ Overwritten .claude/agents/agentic-judge.md

✨ Agent files updated successfully!

```

### Error - Permission Denied

```
Installing agent files...

✓ Created .github/agents/agentic-judge.md
✗ Failed .claude/agents/agentic-judge.md
  Error: Permission denied. Check directory write permissions.

❌ Some agent files could not be installed.

```

Exit code: 1

## Help Output

```
Usage: yb install-agents [options]

Install agentic-judge agent files for GitHub Copilot CLI and Claude Code

Options:
  --force  Overwrite existing agent files
  -h, --help  display help for command

Examples:
  $ yb install-agents                  # Install agent files (skip existing)
  $ yb install-agents --force          # Overwrite existing agent files

This installs the following files in your current directory:
  - .github/agents/agentic-judge.md (for GitHub Copilot CLI)
  - .claude/agents/agentic-judge.md (for Claude Code)

These files are required for the agentic-judge evaluator to function.
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files installed or skipped successfully |
| 1 | One or more files failed to install |
