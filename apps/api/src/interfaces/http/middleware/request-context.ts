import { randomUUID } from 'node:crypto';
import type { Logger } from '../../../application/ports/index.js';
import { toErrorResponse } from '../errors.js';
import { withHeaders } from '../pipeline.js';
import type { Middleware } from '../types.js';

/** Accept a client-supplied request id only if it looks safe (token-ish, bounded length). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Correlation middleware (spec 08 §1, spec 10 §7): adopt the inbound `X-Request-Id` when
 * present and well-formed, otherwise mint one. The id is echoed on every response and made
 * available to downstream handlers/logs as `req.requestId`.
 */
export function requestIdMiddleware(): Middleware {
  return async (req, next) => {
    const inbound = req.headers['x-request-id'];
    req.requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : `req_${randomUUID()}`;
    const res = await next(req);
    return withHeaders(res, { 'x-request-id': req.requestId });
  };
}

/**
 * Outermost error boundary: turn any thrown error into the standard envelope (spec 08 §1)
 * and log unexpected failures with the correlation id. Placed inside `requestId` so the
 * envelope carries the assigned id.
 */
export function errorBoundary(logger: Logger): Middleware {
  return async (req, next) => {
    try {
      return await next(req);
    } catch (err) {
      return toErrorResponse(err, req.requestId, logger);
    }
  };
}

/**
 * Security headers (spec 10 §5): HSTS, no-sniff, framing and a conservative referrer policy.
 * HSTS is advisory here since TLS terminates at Traefik on the VPS, but the header is set so
 * it is present end to end.
 */
export function securityHeaders(): Middleware {
  return async (req, next) => {
    const res = await next(req);
    return withHeaders(res, {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
  };
}
