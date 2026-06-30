import type { Handler, HttpResponse, Middleware } from './types.js';

/**
 * Compose middlewares around a terminal handler (Koa-style onion). The first middleware is
 * the outermost: it runs first and post-processes last. Used by `app.ts` to assemble the
 * request pipeline (error boundary → request-id → headers → cors → route → rate-limit →
 * auth → idempotency → dispatch).
 */
export function compose(middlewares: readonly Middleware[], terminal: Handler): Handler {
  return middlewares.reduceRight<Handler>(
    (next, middleware) => (req) => middleware(req, next),
    terminal,
  );
}

/** Merge headers from a middleware onto a downstream response without clobbering it. */
export function withHeaders(res: HttpResponse, headers: Record<string, string>): HttpResponse {
  return { ...res, headers: { ...headers, ...res.headers } };
}
