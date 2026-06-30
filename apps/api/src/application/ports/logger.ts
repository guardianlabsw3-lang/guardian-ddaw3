/**
 * `Logger` port (spec 04 §3 observability). A minimal structured logger so application
 * services — notably the reconciliation worker, which must **log divergences** between
 * on-chain and off-chain state (TASK-017) — can emit leveled, contextual records without
 * depending on a concrete logging library. Infrastructure supplies the implementation
 * (console in the api, pino in the worker).
 */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/** No-op logger, useful as a default and in tests that don't assert on logging. */
export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
