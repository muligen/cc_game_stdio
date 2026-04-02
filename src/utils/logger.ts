/**
 * logger.ts — Structured logger utility.
 * Configurable log level. Uses level-based filtering for production builds.
 * Graceful degradation: never throws, only logs warnings+.
 *
 * Usage:
 *   const LOG = new Logger('GameRegistryPlugin');
 *   LOG.info('Data loaded.');
 *   LOG.warn('Data missing field: id');
 *   LOG.error('Critical failure');
 */

/** Log level for the logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Numeric log level for comparison. */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 10,
  warn: 20,
  error: 30,
  silent: 40,
};

/**
 * Structured logger that prefixes all output with a module name.
 * Per coding-standards.md: graceful degradation in production, logging in development.
 */
export class Logger {
  private prefix: string;
  private level: LogLevel;

  constructor(prefix: string, level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = level;
  }

  /** Set the minimum log level. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Log a debug-level message. Only shown when level is 'debug'. */
  debug(message: string, ...optionalParams: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[this.level] > LOG_LEVEL_PRIORITY.debug) {
      return;
    }
    console.debug(`[${this.prefix}] ${message}`, ...optionalParams);
  }

  /** Log an info-level message. */
  info(message: string, ...optionalParams: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[this.level] > LOG_LEVEL_PRIORITY.info) {
      return;
    }
    console.info(`[${this.prefix}] ${message}`, ...optionalParams);
  }

  /** Log a warning-level message. */
  warn(message: string, ...optionalParams: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[this.level] > LOG_LEVEL_PRIORITY.warn) {
      return;
    }
    console.warn(`[${this.prefix}] ${message}`, ...optionalParams);
  }

  /** Log an error-level message. */
  error(message: string, ...optionalParams: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[this.level] > LOG_LEVEL_PRIORITY.error) {
      return;
    }
    console.error(`[${this.prefix}] ${message}`, ...optionalParams);
  }

  /** Create a child logger with the same level but a new prefix. */
  child(prefix: string): Logger {
    return new Logger(`${this.prefix}:${prefix}`, this.level);
  }
}
