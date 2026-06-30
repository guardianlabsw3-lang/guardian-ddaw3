import type { z } from 'zod';

/**
 * Application-level errors (use-case orchestration). Each carries a stable `code` and the
 * HTTP `status` the interface layer should return (spec 08 §1 envelope; per-feature error
 * tables in specs 05/06). Distinct from `DomainError` (pure invariants) but shaped the same
 * so a single HTTP exception filter can render both.
 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** Extra HTTP response headers the interface layer should set (e.g. `Retry-After`). */
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    this.headers = headers;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const notFound = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 404, details);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 409, details);

export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 422, details);

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 400, details);

export const unauthorized = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 401, details);

export const forbidden = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApplicationError(code, message, 403, details);

/**
 * Pick a stable error code from zod issues. The shared schemas emit screaming-snake codes
 * as issue messages (e.g. `INVALID_EMAIL`, `ASSET_ISSUER_REQUIRED`); surface the first such
 * code, otherwise fall back to `VALIDATION_ERROR`.
 */
function pickValidationCode(error: z.ZodError): string {
  for (const issue of error.issues) {
    if (/^[A-Z][A-Z0-9_]+$/.test(issue.message)) {
      return issue.message;
    }
  }
  return 'VALIDATION_ERROR';
}

/**
 * Validate `input` against `schema`, throwing an `ApplicationError` (422) with the mapped
 * code and flattened field issues on failure. The return type is the schema's exact output
 * (`z.output`), preserving branded value-object types from the shared schemas.
 */
export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw unprocessable(pickValidationCode(result.error), 'Validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
