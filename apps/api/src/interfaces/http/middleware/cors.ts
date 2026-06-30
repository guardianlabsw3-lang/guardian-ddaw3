import { withHeaders } from '../pipeline.js';
import { json } from '../types.js';
import type { Middleware } from '../types.js';

const ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Authorization,Content-Type,X-Api-Key,Idempotency-Key,X-Request-Id';

/**
 * CORS by explicit allowlist (spec 10 §5 — never `*` in production). The origin is reflected
 * only when it appears in `corsOrigins`; preflight `OPTIONS` requests are answered `204` with
 * the negotiated headers. Requests without an `Origin` (server-to-server API-key callers)
 * pass through untouched.
 */
export function corsMiddleware(corsOrigins: readonly string[]): Middleware {
  const allowed = new Set(corsOrigins);
  return async (req, next) => {
    const origin = req.headers['origin'];
    const allowOrigin = origin && allowed.has(origin) ? origin : null;

    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (allowOrigin) {
      corsHeaders['access-control-allow-origin'] = allowOrigin;
      corsHeaders['access-control-allow-credentials'] = 'true';
    }

    if (req.method.toUpperCase() === 'OPTIONS') {
      return json(204, undefined, {
        ...corsHeaders,
        'access-control-allow-methods': ALLOWED_METHODS,
        'access-control-allow-headers': ALLOWED_HEADERS,
        'access-control-max-age': '600',
      });
    }

    const res = await next(req);
    return withHeaders(res, corsHeaders);
  };
}
