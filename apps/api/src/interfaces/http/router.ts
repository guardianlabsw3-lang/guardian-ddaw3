import { ApplicationError } from '../../application/shared/errors.js';
import type { Handler, HttpRequest, HttpResponse } from './types.js';

export interface Route {
  readonly method: string;
  /** Original pattern, e.g. `/api/tenants/:id/wallet`. */
  readonly pattern: string;
  readonly handler: Handler;
  readonly segments: readonly string[];
  /** Per-route scope requirement enforced by the auth middleware (undefined → public). */
  readonly scopes: readonly string[] | undefined;
  /** Whether the route requires an authenticated principal at all. */
  readonly auth: 'none' | 'admin' | 'any';
  /** When true, the idempotency middleware requires/honours an `Idempotency-Key`. */
  readonly idempotent: boolean;
}

export interface RouteDefinition {
  method: string;
  path: string;
  handler: Handler;
  /** `none` (public), `admin` (JWT only) or `any` (admin or API key). Default `any`. */
  auth?: 'none' | 'admin' | 'any';
  /** Required API-key scopes (only meaningful for `any`/api-key callers). */
  scopes?: readonly string[];
  /** Opt the route into idempotency-key handling (order creation; spec 08 §4). */
  idempotent?: boolean;
}

/**
 * Tiny framework-free router (spec 04 keeps the domain/application framework-free; the HTTP
 * edge is intentionally thin). Matches `METHOD` + path patterns with `:param` segments and
 * exposes the matched route so middleware (auth) can read its `auth`/`scopes` metadata
 * before the handler runs.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(def: RouteDefinition): this {
    this.routes.push({
      method: def.method.toUpperCase(),
      pattern: def.path,
      handler: def.handler,
      segments: splitPath(def.path),
      scopes: def.scopes,
      auth: def.auth ?? 'any',
      idempotent: def.idempotent ?? false,
    });
    return this;
  }

  /** All registered routes — used by the OpenAPI contract test to assert coverage. */
  list(): readonly Route[] {
    return this.routes;
  }

  /**
   * Resolve a request to a route, capturing path params. Returns `null` when no path
   * matches, or throws `405 METHOD_NOT_ALLOWED` when the path matches a different method.
   */
  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const segments = splitPath(path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (params === null) {
        continue;
      }
      pathMatched = true;
      if (route.method === method.toUpperCase()) {
        return { route, params };
      }
    }
    if (pathMatched) {
      throw new ApplicationError('METHOD_NOT_ALLOWED', `Method ${method} not allowed`, 405);
    }
    return null;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Returns captured params when the route segments match the request segments, else null. */
function matchSegments(
  routeSegments: readonly string[],
  reqSegments: readonly string[],
): Record<string, string> | null {
  if (routeSegments.length !== reqSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i += 1) {
    const rs = routeSegments[i]!;
    const seg = reqSegments[i]!;
    if (rs.startsWith(':')) {
      params[rs.slice(1)] = decodeURIComponent(seg);
    } else if (rs !== seg) {
      return null;
    }
  }
  return params;
}

/**
 * Run the router as a terminal handler: match the route, attach params, and invoke its
 * handler. A non-matching path yields a `404 NOT_FOUND`. Middleware wraps this so cross
 * cutting concerns (auth/idempotency/rate-limit) read `req` after the route is known.
 */
export function routerHandler(router: Router): Handler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const matched = router.match(req.method, req.path);
    if (!matched) {
      throw new ApplicationError('NOT_FOUND', `No route for ${req.method} ${req.path}`, 404);
    }
    req.params = matched.params;
    return matched.route.handler(req);
  };
}
