# Quickstart: Agent File Installation

**Feature**: 004-agent-file-install  
**Date**: 2025-11-30

## Overview

This feature adds automatic installation of agentic-judge agent files during `yb init` and provides a standalone `yb install-agents` command for updating agent files independently.

## User Workflows

### New User (via init)

```bash
# Create new youBencha project
mkdir my-project && cd my-project
yb init

# Output:
# ✓ Created testcase.yaml
# ✓ Created .github/agents/agentic-judge.md
# ✓ Created .claude/agents/agentic-judge.md
# 
# ✨ Ready to evaluate with agentic-judge!
```

### Existing User (update agents)

```bash
# In existing youBencha project
yb install-agents

# Output:
# ✓ Created .github/agents/agentic-judge.md
# ✓ Created .claude/agents/agentic-judge.md
```

### Force Update

```bash
# Replace existing agent files with latest versions
yb install-agents --force

# Output:
# ⚠️  Overwriting existing agent files
# ✓ Overwritten .github/agents/agentic-judge.md
# ✓ Overwritten .claude/agents/agentic-judge.md
```

## Files Installed

| Path | Purpose |
|------|---------|
| `.github/agents/agentic-judge.md` | Agent for GitHub Copilot CLI evaluations |
| `.claude/agents/agentic-judge.md` | Agent for Claude Code evaluations |

## Command Reference

### yb init

Creates starter configuration AND installs agent files.

```bash
yb init [--force]
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing testcase.yaml AND agent files |

### yb install-agents

Installs only agent files (no testcase.yaml).

```bash
yb install-agents [--force]
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing agent files |

## Troubleshooting

### "Permission denied" error

The CLI cannot write to the target directory. Check:
- You own the directory or have write permissions
- The filesystem is not read-only

```bash
# Check permissions
ls -la .github/agents/

# Fix permissions (if you own the directory)
chmod -R u+w .github .claude
```

### "Agent files already exist"

Files were previously installed. Options:
1. Keep existing files (default behavior)
2. Use `--force` to overwrite with latest versions

### Agent files not working

Verify files are correctly placed:

```bash
# Should show both files
ls -la .github/agents/agentic-judge.md
ls -la .claude/agents/agentic-judge.md
```

Verify content is not corrupted:

```bash
# Should show YAML frontmatter with "name: agentic-judge"
head -5 .github/agents/agentic-judge.md
```

## Developer Notes

### Adding New Agent Files

To add additional agent files in future versions:

1. Add content constant to `src/agents/`
2. Register in `AGENT_FILES` array in `src/lib/agent-files.ts`
3. Update tests

### Customizing Agent Files

Users can customize installed agent files. The `--force` flag will overwrite customizations, so users should:
1. Keep backups of customizations
2. Avoid using `--force` unless intentionally resetting
