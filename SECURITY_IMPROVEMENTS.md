# Security Improvements

This document outlines the security enhancements made to the youBencha CLI codebase.

## Overview

A comprehensive security audit was conducted to identify and fix vulnerabilities in the codebase. The following sections detail the issues found and the fixes implemented.

## Critical Vulnerabilities Fixed

### 1. Command Injection in Copilot CLI Adapter

**Issue:** The copilot-cli adapter was vulnerable to command injection attacks through user-controlled inputs (prompt, agent name, workspace directory).

**Impact:** HIGH - An attacker could execute arbitrary commands on the system by crafting malicious input strings.

**Fix:** 
- Added `validateCommandInput()` method to sanitize all command inputs
- Blocks shell metacharacters and control characters on both Windows and Unix
- Validates against null bytes, newlines, and dangerous characters (`&`, `|`, `;`, `<`, `>`, etc.)
- File: `src/adapters/copilot-cli.ts`

**Code Example:**
```typescript
private validateCommandInput(input: string, fieldName: string): void {
  // Check for null bytes
  if (input.includes('\0')) {
    throw new Error(`${fieldName} contains null bytes`);
  }
  // Check for newlines
  if (input.includes('\n') || input.includes('\r')) {
    throw new Error(`${fieldName} contains newline characters`);
  }
  // Platform-specific dangerous character checks
  // ...
}
```

### 2. Path Traversal in Agentic Judge Evaluator

**Issue:** The evaluator allowed loading instruction files from arbitrary paths without validation, enabling path traversal attacks (e.g., `../../../etc/passwd`).

**Impact:** HIGH - An attacker could read sensitive files from the filesystem outside the workspace.

**Fix:**
- Added `validateAndResolvePath()` method with comprehensive path validation
- Blocks null bytes and enforces path normalization
- Restricts file access to current working directory only
- Validates symlinks and their targets
- Adds file size limits (1MB) to prevent memory exhaustion
- File: `src/evaluators/agentic-judge.ts`

**Code Example:**
```typescript
private validateAndResolvePath(filePath: string): string {
  // Normalize and resolve path
  const normalizedPath = path.normalize(path.resolve(...));
  
  // Verify path is within allowed directories
  const cwd = path.resolve(process.cwd());
  if (!normalizedPath.startsWith(cwd)) {
    throw new Error('Access to file outside working directory is not allowed');
  }
  
  // Additional validations for symlinks, file type, etc.
  // ...
}
```

### 3. YAML Bomb / Billion Laughs Attack

**Issue:** YAML parsing had no limits on alias expansion or nesting depth, allowing denial-of-service attacks through YAML bombs.

**Impact:** MEDIUM-HIGH - An attacker could cause memory exhaustion and crash the application.

**Fix:**
- Added `maxAliasCount: 100` limit to YAML parsing
- Added `maxDepth: 10` validation for object nesting
- Enabled strict parsing mode
- File: `src/cli/commands/run.ts`

**Code Example:**
```typescript
configData = yaml.parse(configContent, {
  maxAliasCount: 100,  // Limit alias expansion
  strict: true,         // Strict parsing mode
});

// Validate depth of parsed config
const maxDepth = 10;
const depth = getObjectDepth(configData);
if (depth > maxDepth) {
  logger.error(`Configuration structure too deep: ${depth} levels (max: ${maxDepth})`);
  process.exit(1);
}
```

## Medium Priority Issues Fixed

### 4. Incomplete Private Network Blocking

**Issue:** Repository URL validation only blocked some private IP ranges, missing several RFC-defined private networks.

**Impact:** MEDIUM - Could potentially be exploited for SSRF attacks against internal networks.

**Fix:**
- Enhanced IP address validation to block:
  - All loopback addresses (127.0.0.0/8, ::1)
  - All RFC 1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - Link-local addresses (169.254.0.0/16, fe80::/10)
  - Unique local IPv6 (fc00::/7)
  - mDNS domains (.local)
- File: `src/schemas/suite.schema.ts`

### 5. Missing Resource Limits on Git Operations

**Issue:** Git clone operations had no resource constraints, allowing potential DoS through large repositories.

**Impact:** MEDIUM - Could exhaust disk space or memory through malicious repository URLs.

**Fix:**
- Added repository size limit (1GB)
- Limited HTTP post buffer (10MB)
- Set concurrent process limit to 1
- Reduced compression level for controlled resource usage
- File: `src/core/workspace.ts`

**Code Example:**
```typescript
const git: SimpleGit = simpleGit({
  timeout: { block: timeout },
  maxConcurrentProcesses: 1,
});

cloneOptions.push('-c', 'http.postBuffer=10485760'); // 10MB
cloneOptions.push('-c', 'core.compression=1');

// Verify cloned repository size
const repoSize = await this.getDirectorySize(targetDir);
const maxRepoSize = 1024 * 1024 * 1024; // 1GB
if (repoSize > maxRepoSize) {
  throw new WorkspaceError(...);
}
```

## Additional Security Enhancements

### File Size Limits

- Configuration files: 1MB maximum (`src/cli/commands/run.ts`)
- Instruction files: 1MB maximum (`src/evaluators/agentic-judge.ts`)
- Repository size: 1GB maximum (`src/core/workspace.ts`)

### Input Validation

All external inputs are now validated:
- Repository URLs (protocol, hostname, private networks)
- File paths (traversal, symlinks, null bytes)
- Command arguments (shell metacharacters, control characters)
- Configuration depth and complexity

### Build Fix

**Issue:** Duplicate `__filename` declaration caused Jest test failures due to ES module/CommonJS compatibility.

**Fix:** Wrapped `import.meta` usage in a runtime check to support both ES modules and Jest/CommonJS environments.

File: `src/evaluators/agentic-judge.ts`

## Security Testing

All security fixes have been validated through:
1. Unit tests for individual validation functions
2. Contract tests for schema validation
3. Build verification
4. Manual testing of edge cases

## Recommendations for Users

1. **Only run trusted suite configurations** - Suite files can specify repository URLs and evaluation criteria
2. **Use isolated environments** - Run youBencha in containers or VMs for untrusted evaluations
3. **Keep dependencies updated** - Run `npm audit fix` regularly
4. **Review agent outputs** - Inspect evaluation results before applying changes to production
5. **Use specific commit SHAs** - Prefer commit SHAs over branch names for reproducibility and security

## Future Security Enhancements

Potential areas for additional security improvements:

1. **Sandboxing** - Run agent evaluations in separate sandboxed environments
2. **Network isolation** - Option to disable network access during evaluations
3. **Resource quotas** - CPU and memory limits per evaluation
4. **Audit logging** - Detailed logs of all file system and network operations
5. **Content Security Policy** - Additional restrictions on loaded content
6. **Signature verification** - Verify suite configuration signatures

## Reporting Security Issues

Please refer to [SECURITY.md](SECURITY.md) for information on reporting security vulnerabilities.

## References

- OWASP Command Injection: https://owasp.org/www-community/attacks/Command_Injection
- Path Traversal Attack: https://owasp.org/www-community/attacks/Path_Traversal
- YAML Bomb: https://en.wikipedia.org/wiki/Billion_laughs_attack
- SSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
