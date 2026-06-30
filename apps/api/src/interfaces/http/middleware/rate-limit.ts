import { ApplicationError } from '../../../application/shared/errors.js';
import type { RateLimiter } from '../../../infrastructure/ratelimit/rate-limiter.js';
import { withHeaders } from '../pipeline.js';
import type { HttpRequest, Middleware } from '../types.js';

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
    const result = limiter.hit(key);
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
