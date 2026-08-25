import { MAX_BATCH_SIZE } from '../../../application/payment-order/create-payment-order-batch.js';
import { ApplicationError } from '../../../application/shared/errors.js';
import type { RateLimiter } from '../../../infrastructure/ratelimit/rate-limiter.js';
import { withHeaders } from '../pipeline.js';
import type { HttpRequest, Middleware } from '../types.js';

const BATCH_ROUTE_PATTERN = '/api/payment-orders/batch';

/**
 * Rate limiting per API key / IP (spec 08 §1, spec 10 §5). The bucket key prefers the
 * authenticated principal (so a key's quota follows it across IPs) and falls back to the
 * client IP for anonymous/public traffic. Over-limit requests get `429` with a `Retry-After`
 * header; allowed requests carry `X-RateLimit-*` headers.
 *
 * Runs after auth so `req.principal` is populated, but limits are still applied to anonymous
 * callers by IP.
 */
export function rateLimitMiddleware(limiter: RateLimiter): Middleware {
  return async (req, next) => {
    const key = bucketKey(req);
    const result = limiter.hit(key, batchCost(req));
    const headers = {
      'x-ratelimit-limit': String(result.limit),
      'x-ratelimit-remaining': String(result.remaining),
    };
    if (!result.allowed) {
      throw new ApplicationError('RATE_LIMITED', 'Too many requests', 429, undefined, {
        'retry-after': String(result.retryAfterSeconds),
        ...headers,
      });
    }
    const res = await next(req);
    return withHeaders(res, headers);
  };
}

/**
 * Weight the batch payment-orders route by its item count (feature "batch-payment-orders") so
 * a 100-item batch costs ~100 units of the same budget 100 single-order calls would have —
 * otherwise a caller could bypass the per-order throughput limit by batching. Every other
 * route costs the default `1`. `req.json()` is memoized (`request.ts`), so peeking here is
 * free when the handler parses the same body later; malformed JSON is never surfaced from
 * this middleware — it falls back to cost `1` and still 400s from the handler as it does
 * today, at its usual point in the pipeline.
 */
function batchCost(req: HttpRequest): number {
  if (req.route?.pattern !== BATCH_ROUTE_PATTERN) {
    return 1;
  }
  try {
    const body = req.json<{ orders?: unknown[] }>();
    const count = Array.isArray(body?.orders) ? body.orders.length : 1;
    return Math.min(Math.max(count, 1), MAX_BATCH_SIZE);
  } catch {
    return 1;
  }
}

function bucketKey(req: HttpRequest): string {
  if (req.principal) {
    return `${req.principal.kind}:${req.principal.id}`;
  }
  return `ip:${clientIp(req)}`;
}

/** Best-effort client IP: first `X-Forwarded-For` hop (Traefik), then `X-Real-IP`. */
export function clientIp(req: HttpRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.headers['x-real-ip'] ?? 'unknown';
}
