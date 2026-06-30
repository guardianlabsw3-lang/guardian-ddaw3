import pino, { type Logger as PinoLoggerInstance } from 'pino';
import type { Logger, LogContext } from '@payorder/api';

/**
 * Pino-backed `Logger` (spec 04 §2.4 — worker shares the api's stack). Implements the api's
 * `Logger` port so the framework-free use cases log structured records (notably on-chain /
 * off-chain divergences, TASK-017) without depending on pino directly.
 */
export class PinoLogger implements Logger {
  private readonly pino: PinoLoggerInstance;

  constructor(level: string = process.env.LOG_LEVEL ?? 'info') {
    this.pino = pino({ level });
  }

  debug(message: string, context?: LogContext): void {
    this.pino.debug(context ?? {}, message);
  }
  info(message: string, context?: LogContext): void {
    this.pino.info(context ?? {}, message);
  }
  warn(message: string, context?: LogContext): void {
    this.pino.warn(context ?? {}, message);
  }
  error(message: string, context?: LogContext): void {
    this.pino.error(context ?? {}, message);
  }
}
