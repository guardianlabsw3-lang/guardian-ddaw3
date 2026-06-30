import type {
  ApiKeyRepository,
  IdempotencyStore,
  Logger,
  TokenService,
} from '../../application/ports/index.js';
import { ApplicationError } from '../../application/shared/errors.js';
import type { RateLimiter } from '../../infrastructure/ratelimit/rate-limiter.js';
import { corsMiddleware } from './middleware/cors.js';
import { authMiddleware } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import {
  errorBoundary,
  requestIdMiddleware,
  securityHeaders,
} from './middleware/request-context.js';
import { compose } from './pipeline.js';
import { Router, type RouteDefinition } from './router.js';
import type { Handler, HttpRequest, HttpResponse, Middleware } from './types.js';

export interface AppDeps {
  logger: Logger;
  tokens: TokenService;
  apiKeys: ApiKeyRepository;
  rateLimiter: RateLimiter;
  idempotencyStore: IdempotencyStore;
  corsOrigins: readonly string[];
  /** All controller routes, concatenated by the composition root. */
  routes: RouteDefinition[];
}

export interface App {
  /** Registered router (exposed so the OpenAPI contract test can assert coverage). */
  router: Router;
  /** Run a normalized request through the full middleware pipeline. */
  handle(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Assemble the HTTP application (framework-free). Order matters: `requestId` is outermost so
 * every response (including errors) is correlated; `securityHeaders`/`cors` wrap the error
 * boundary so even `4xx`/`5xx` carry them; route resolution precedes rate-limit, auth and
 * idempotency, which read the matched route's metadata.
 */
export function createApp(deps: AppDeps): App {
  const router = new Router();
  for (const route of deps.routes) {
    router.add(route);
  }

  const resolveRoute: Middleware = async (req, next) => {
    const matched = router.match(req.method, req.path);
    if (!matched) {
      throw new ApplicationError('NOT_FOUND', `No route for ${req.method} ${req.path}`, 404);
    }
    req.route = matched.route;
    req.params = matched.params;
    return next(req);
  };

  const dispatch: Handler = (req) => req.route!.handler(req);

  const pipeline = compose(
    [
      requestIdMiddleware(),
      securityHeaders(),
      corsMiddleware(deps.corsOrigins),
      errorBoundary(deps.logger),
      resolveRoute,
      rateLimitMiddleware(deps.rateLimiter),
      authMiddleware({ tokens: deps.tokens, apiKeys: deps.apiKeys }),
      idempotencyMiddleware(deps.idempotencyStore),
    ],
    dispatch,
  );

  return { router, handle: (req) => Promise.resolve(pipeline(req)) };
}
