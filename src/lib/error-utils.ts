/**
 * Error sanitization utilities
 */

export interface SanitizedError {
  message: string;
  stack_trace?: string;
}

/**
 * Sanitize error for public output
 * Removes absolute paths and sensitive information
 */
export function sanitizeError(
  error: unknown,
  includeStack: boolean = process.env.NODE_ENV === 'development'
): SanitizedError {
  const err = error instanceof Error ? error : new Error(String(error));
  
  // Sanitize message - remove absolute paths
  let message = err.message;
  
  // Remove Windows paths (C:\Users\...)
  message = message.replace(/[A-Z]:\\[\w\\.-]+/g, '[PATH]');
  
  // Remove Unix paths (/home/user/...)
  message = message.replace(/\/[\w/.-]+/g, (match) => {
    // Keep relative paths, sanitize absolute
    if (match.startsWith('/home') || match.startsWith('/Users') || match.startsWith('/root')) {
      return '[PATH]';
    }
    return match;
  });
  
  const result: SanitizedError = { message };
  
  // Only include stack trace in development
  if (includeStack && err.stack) {
    // Sanitize stack trace too
    let stack = err.stack;
    stack = stack.replace(/[A-Z]:\\[\w\\.-]+/g, '[PATH]');
    stack = stack.replace(/\/home\/[\w/.-]+/g, '[PATH]');
    stack = stack.replace(/\/Users\/[\w/.-]+/g, '[PATH]');
    result.stack_trace = stack;
  }
  
  return result;
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
