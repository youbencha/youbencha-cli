# Research: Agent File Installation

**Feature**: 004-agent-file-install  
**Date**: 2025-11-30  
**Status**: Complete

## Research Tasks

### 1. File Bundling Strategy

**Question**: How should agent files be bundled with the youBencha package?

**Decision**: Bundle as TypeScript string constants in `src/agents/` module

**Rationale**:
- Agent files are small (~114 lines each), well within reasonable string constant size
- Avoids runtime file system reads from node_modules (cross-platform path issues)
- TypeScript compiler catches missing content at build time
- Matches existing pattern: `STARTER_TESTCASE` constant in `init.ts`
- No external fetch required - works offline

**Alternatives Considered**:
1. **Read from node_modules at runtime**: Rejected - path resolution varies by npm version, symlinks, and installation method
2. **Copy files during npm postinstall**: Rejected - postinstall scripts are often disabled in CI/CD
3. **Fetch from GitHub raw URLs**: Rejected - requires network, adds failure mode, violates offline constraint

### 2. Directory Creation Pattern

**Question**: How should we handle nested directory creation (`.github/agents/`, `.claude/agents/`)?

**Decision**: Use `fs.mkdir()` with `recursive: true` option

**Rationale**:
- Native Node.js API, no additional dependencies
- `recursive: true` creates parent directories if missing
- Idempotent - doesn't fail if directory exists
- Already available in Node.js 20+ (our target platform)

**Alternatives Considered**:
1. **fs-extra.ensureDir()**: Rejected - adds dependency for simple use case
2. **Manual path.dirname() + mkdir**: Rejected - more code, same result

### 3. File Conflict Handling

**Question**: How should we handle existing agent files?

**Decision**: Check existence with `fs.access()`, skip unless `--force` flag

**Rationale**:
- Prevents accidental data loss (user may have customized agent files)
- `--force` provides explicit override mechanism
- Matches existing `init` command pattern for `testcase.yaml`
- Provides clear user feedback for each file (created/skipped/overwritten)

**Implementation Pattern**:
```typescript
async function installAgentFile(path: string, content: string, force: boolean): Promise<'created' | 'skipped' | 'overwritten'> {
  const exists = await fileExists(path);
  if (exists && !force) {
    return 'skipped';
  }
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content, 'utf-8');
  return exists ? 'overwritten' : 'created';
}
```

### 4. Error Handling Strategy

**Question**: How should we handle filesystem errors (permissions, disk full)?

**Decision**: Catch and report with specific error messages, non-zero exit code

**Rationale**:
- Users need actionable error messages
- Permission errors should suggest `chmod` or admin rights
- Disk errors should indicate storage issue
- Partial success should be reported (some files created, some failed)

**Error Categories**:
| Error Code | User Message |
|------------|--------------|
| EACCES | "Permission denied. Check directory write permissions." |
| ENOSPC | "Disk full. Free up space and try again." |
| EROFS | "Read-only filesystem. Cannot write agent files." |
| ENOENT | (handled by recursive mkdir - should not occur) |

### 5. CLI Command Design

**Question**: Should `install-agents` be a subcommand or top-level command?

**Decision**: Top-level command `yb install-agents`

**Rationale**:
- Follows existing CLI pattern (`yb init`, `yb run`, `yb report`)
- Simple, discoverable command name
- No nesting complexity for users

**Command Signature**:
```bash
yb install-agents [--force]
```

### 6. Agent File Content Synchronization

**Question**: How do we keep bundled agent content in sync with source files?

**Decision**: Source of truth is TypeScript constants; update when releasing

**Rationale**:
- Single source of truth avoids drift
- Constants are checked at compile time
- Package version indicates agent file version
- Document in CONTRIBUTING.md for maintainers

**Maintenance Process**:
1. Edit agent file content in `src/agents/agentic-judge.ts`
2. Corresponding `.github/agents/` and `.claude/agents/` files in repo are for development/testing
3. Before release, verify bundled content matches source files
4. Consider build script to auto-sync in future if drift becomes issue

### 7. Integration with Init Command

**Question**: How should `init` call the agent installation logic?

**Decision**: Extract shared function `installAgentFiles()` in `src/lib/agent-files.ts`

**Rationale**:
- DRY - same logic used by both `init` and `install-agents`
- Single place to update agent file list
- Easier testing - can unit test the function directly

**Function Signature**:
```typescript
interface InstallResult {
  file: string;
  status: 'created' | 'skipped' | 'overwritten';
}

async function installAgentFiles(
  targetDir: string, 
  options: { force?: boolean }
): Promise<InstallResult[]>
```

## Best Practices Applied

### From Constitution VII (Security by Design)

- ✅ No user input in file paths (hardcoded relative paths only)
- ✅ `path.join()` used for path construction (prevents traversal)
- ✅ No shell execution - direct fs API calls
- ✅ Write to user's cwd only, never outside

### From Existing Codebase Patterns

- ✅ Use `logger.*` for consistent output formatting
- ✅ Use `ora` spinners for progress indication
- ✅ Exit with code 0 on success, 1 on error
- ✅ Support both `yb` and `youbencha` command names in help text

## Dependencies

No new dependencies required. Uses:
- `fs/promises` (Node.js built-in)
- `path` (Node.js built-in)
- `commander` (existing)
- `ora` (existing, via `src/lib/progress.js`)
- `src/lib/logger.js` (existing)

## Open Questions

None - all clarifications resolved.
