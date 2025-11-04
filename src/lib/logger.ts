/**
 * Logger Utility
 * 
 * Console-based logging with multiple severity levels.
 * Provides consistent logging across the youBencha framework.
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to display */
  level: LogLevel;
  
  /** Whether to include timestamps */
  timestamps: boolean;
  
  /** Custom prefix for all log messages */
  prefix?: string;
}

/**
 * Default logger configuration
 */
const defaultConfig: LoggerConfig = {
  level: LogLevel.INFO,
  timestamps: false,
  prefix: '[youBencha]',
};

/**
 * Current logger configuration
 */
let currentConfig: LoggerConfig = { ...defaultConfig };

/**
 * Log level priority (higher = more severe)
 */
const levelPriority: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/**
 * Check if a log level should be displayed
 */
function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[currentConfig.level];
}

/**
 * Format log message with optional timestamp and prefix
 */
function formatMessage(level: LogLevel, message: string): string {
  const parts: string[] = [];

  if (currentConfig.timestamps) {
    parts.push(`[${new Date().toISOString()}]`);
  }

  if (currentConfig.prefix) {
    parts.push(currentConfig.prefix);
  }

  parts.push(`[${level.toUpperCase()}]`);
  parts.push(message);

  return parts.join(' ');
}

/**
 * Log debug message
 */
export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.DEBUG)) {
    console.debug(formatMessage(LogLevel.DEBUG, message), ...args);
  }
}

/**
 * Log info message
 */
export function info(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.INFO)) {
    console.info(formatMessage(LogLevel.INFO, message), ...args);
  }
}

/**
 * Log warning message
 */
export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.WARN)) {
    console.warn(formatMessage(LogLevel.WARN, message), ...args);
  }
}

/**
 * Log error message
 */
export function error(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.ERROR)) {
    console.error(formatMessage(LogLevel.ERROR, message), ...args);
  }
}

/**
 * Configure logger
 */
export function configure(config: Partial<LoggerConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Reset logger to default configuration
 */
export function reset(): void {
  currentConfig = { ...defaultConfig };
}

/**
 * Get current logger configuration
 */
export function getConfig(): LoggerConfig {
  return { ...currentConfig };
}

/**
 * Create a scoped logger with custom prefix
 */
export function createLogger(prefix: string): {
  debug: typeof debug;
  info: typeof info;
  warn: typeof warn;
  error: typeof error;
} {
  return {
    debug: (message: string, ...args: unknown[]): void => {
      if (shouldLog(LogLevel.DEBUG)) {
        console.debug(formatMessage(LogLevel.DEBUG, `${prefix} ${message}`), ...args);
      }
    },
    info: (message: string, ...args: unknown[]): void => {
      if (shouldLog(LogLevel.INFO)) {
        console.info(formatMessage(LogLevel.INFO, `${prefix} ${message}`), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]): void => {
      if (shouldLog(LogLevel.WARN)) {
        console.warn(formatMessage(LogLevel.WARN, `${prefix} ${message}`), ...args);
      }
    },
    error: (message: string, ...args: unknown[]): void => {
      if (shouldLog(LogLevel.ERROR)) {
        console.error(formatMessage(LogLevel.ERROR, `${prefix} ${message}`), ...args);
      }
    },
  };
}

/**
 * Default export with all logging functions
 */
export default {
  debug,
  info,
  warn,
  error,
  configure,
  reset,
  getConfig,
  createLogger,
  LogLevel,
};
