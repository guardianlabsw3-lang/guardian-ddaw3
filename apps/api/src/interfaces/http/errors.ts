import { ApplicationError } from '../../application/shared/errors.js';
import { DomainError } from '../../domain/shared/errors.js';
import type { HttpResponse } from './types.js';
import type { Logger } from '../../application/ports/index.js';

/** Standard error envelope (spec 08 §1). */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details: Record<string, unknown>;
  };
}

/**
 * Map any thrown error to the standard HTTP error envelope (spec 08 §1). `ApplicationError`
 * and `DomainError` carry a stable `code`; domain invariant violations surface as `422`.
 * Anything else is an unexpected `500` whose internals are **never** leaked to the client
 * (spec 10 §7) — only logged with the correlation id.
 */
export function toErrorResponse(err: unknown, requestId: string, logger: Logger): HttpResponse {
  if (err instanceof ApplicationError) {
    const res = envelope(err.status, err.code, err.message, requestId, err.details);
    if (err.headers) {
      res.headers = { ...err.headers, ...res.headers };
    }
    return res;
  }
  if (err instanceof DomainError) {
    return envelope(422, err.code, err.message, requestId, err.details);
  }
  // Unexpected: log the full error with correlation, return an opaque 500.
  logger.error('unhandled error', {
    requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return envelope(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId, undefined);
}

function envelope(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> | undefined,
): HttpResponse {
  const body: ErrorEnvelope = {
    error: { code, message, request_id: requestId, details: details ?? {} },
  };
  return { status, headers: {}, body };
}
