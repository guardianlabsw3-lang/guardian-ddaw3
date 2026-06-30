import type { Logger, LogContext } from '../../application/ports/index.js';

/**
 * Minimal structured `Logger` over `console`, emitting one JSON line per record. Used as the
 * api's default; the worker swaps in a pino-backed logger. Kept dependency-free so the api
 * package needs no logging library at this phase.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(level: LogLevel = 'info') {
    this.threshold = LEVEL_ORDER[level];
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < this.threshold) {
      return;
    }
    const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...context });
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
