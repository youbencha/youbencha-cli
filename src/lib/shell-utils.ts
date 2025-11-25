/**
 * Shell Utilities
 * 
 * Cross-platform utilities for shell command escaping and validation.
 * Supports PowerShell (Windows) and bash/zsh (macOS/Linux).
 */

/**
 * Escape a string for safe use as a shell argument.
 * 
 * @param arg - The argument to escape
 * @param shell - The target shell type ('powershell' | 'bash')
 * @returns The escaped string
 */
export function escapeShellArg(
  arg: string,
  shell: 'powershell' | 'bash' = process.platform === 'win32' ? 'powershell' : 'bash'
): string {
  if (shell === 'powershell') {
    return escapeForPowerShell(arg);
  } else {
    return escapeForBash(arg);
  }
}

/**
 * Escape a string for PowerShell.
 * Uses single quotes with doubled single quotes for escaping.
 * 
 * @param arg - The argument to escape
 * @returns The escaped string wrapped in single quotes
 */
function escapeForPowerShell(arg: string): string {
  // In PowerShell, single-quoted strings are literal except for single quotes
  // Single quotes are escaped by doubling them
  const escaped = arg.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Escape a string for bash/zsh.
 * Uses single quotes with proper handling of embedded single quotes.
 * 
 * @param arg - The argument to escape
 * @returns The escaped string wrapped in single quotes
 */
function escapeForBash(arg: string): string {
  // In bash, single-quoted strings are literal except for single quotes
  // To include a single quote, end the string, add escaped quote, restart
  // 'can'\''t' becomes: can't
  const escaped = arg.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

/**
 * Strip ANSI escape codes from a string.
 * 
 * @param text - The text containing ANSI codes
 * @returns The text with ANSI codes removed
 */
export function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  return text.replace(ansiPattern, '');
}

/**
 * Validate that a path is safe (no path traversal).
 * 
 * @param filePath - The path to validate
 * @returns true if the path is safe, false otherwise
 */
export function isPathSafe(filePath: string): boolean {
  // Reject absolute paths
  if (filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)) {
    return false;
  }
  
  // Reject path traversal attempts
  if (filePath.includes('..')) {
    return false;
  }
  
  // Reject paths starting with backslash (Windows UNC or root)
  if (filePath.startsWith('\\')) {
    return false;
  }
  
  return true;
}

/**
 * Detect the current shell type based on platform.
 * 
 * @returns 'powershell' for Windows, 'bash' for others
 */
export function detectShell(): 'powershell' | 'bash' {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}
