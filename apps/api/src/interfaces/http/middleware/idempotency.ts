import { createHash } from 'node:crypto';
import type { IdempotencyStore } from '../../../application/ports/index.js';
import { badRequest, conflict } from '../../../application/shared/errors.js';
import type { Middleware } from '../types.js';

/** Idempotency window for stored responses (spec 08 §4 — 24h). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Idempotency-Key handling for opted-in routes (spec 08 §4, TASK-021). On a route flagged
 * `idempotent`:
 *  - a missing key is rejected `400 IDEMPOTENCY_KEY_REQUIRED`;
 *  - a replay with the same body returns the **stored** response verbatim;
 *  - a replay with a divergent body for the same key is `409 IDEMPOTENCY_KEY_CONFLICT`;
 *  - a first, successful (`< 400`) response is memorized for the TTL window.
 * Natural idempotency by `(tenant_id, external_id)` still applies underneath (spec 08 §4).
 */
export function idempotencyMiddleware(store: IdempotencyStore): Middleware {
  return async (req, next) => {
    if (!req.route?.idempotent) {
      return next(req);
    }

    const key = req.headers['idempotency-key'];
    if (!key || key.trim().length === 0) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required');
    }

    const endpoint = `${req.method.toUpperCase()} ${req.route.pattern}`;
    const requestHash = createHash('sha256').update(req.rawBody).digest('hex');

    const existing = await store.find(key, endpoint);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw conflict(
          'IDEMPOTENCY_KEY_CONFLICT',
          'This Idempotency-Key was used with a different request body',
        );
      }
      return {
        status: existing.responseStatus,
        headers: { 'idempotent-replayed': 'true' },
        body: existing.responseBody,
      };
    }

    const res = await next(req);
    if (res.status < 400) {
      await store.save(key, endpoint, requestHash, res.status, res.body, IDEMPOTENCY_TTL_SECONDS);
    }
    return res;
  };
}
