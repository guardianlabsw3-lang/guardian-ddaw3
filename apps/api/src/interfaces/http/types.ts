import { ApplicationError } from '../../application/shared/errors.js';

/**
 * Authenticated principal attached to a request by the auth middleware (spec 08 §1/§6).
 * `admin` comes from a JWT bearer token; `api-key` from a verified `X-Api-Key`. The
 * principal carries the granted scopes and, for API keys, the optional tenant allowlist that
 * constrains which tenants the caller may act on.
 */
export interface Principal {
  readonly kind: 'admin' | 'api-key';
  readonly id: string;
  readonly scopes: readonly string[];
  /** API keys only: when non-null, the caller may only touch these tenant ids. */
  readonly allowedTenantIds: readonly string[] | null;
  /** Human-friendly label for audit logs (admin email or api-key name). */
  readonly label: string;
}

/**
 * Normalized HTTP request flowing through the framework-free router. Built once per request
 * by `server.ts` (or directly by tests) and decorated by middleware (`requestId`,
 * `principal`, route `params`).
 */
export interface HttpRequest {
  readonly method: string;
  /** URL pathname, no query string. */
  readonly path: string;
  readonly query: URLSearchParams;
  /** Header names lower-cased; multi-value headers joined with `, `. */
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  /** Route parameters captured from the matched pattern (e.g. `:id`). */
  params: Record<string, string>;
  requestId: string;
  principal: Principal | undefined;
  /** The matched route's metadata, set by the route-resolution step before middleware runs. */
  route: RouteMeta | undefined;
  /** Parse the JSON body, throwing `INVALID_JSON` (400) on malformed input. */
  json<T = unknown>(): T;
}

/** Subset of a matched route the middleware pipeline reads (auth/scopes/handler). */
export interface RouteMeta {
  readonly auth: 'none' | 'admin' | 'any';
  readonly scopes: readonly string[] | undefined;
  readonly pattern: string;
  readonly handler: Handler;
  /** When true, the route requires and honours an `Idempotency-Key` header. */
  readonly idempotent: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON-serializable body, or `undefined` for an empty body (e.g. 204). */
  body: unknown;
}

export type Handler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

/** Koa-style middleware: wraps `next` so it can short-circuit or post-process. */
export type Middleware = (req: HttpRequest, next: Handler) => Promise<HttpResponse>;

/** Build a JSON response, defaulting the content-type header. */
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponse {
  return { status, body, headers };
}

/** 204 No Content. */
export function noContent(headers: Record<string, string> = {}): HttpResponse {
  return { status: 204, body: undefined, headers };
}

/** Parse a raw JSON body string, raising a 400 `INVALID_JSON` application error on failure. */
export function parseJsonBody<T = unknown>(rawBody: string): T {
  if (rawBody.trim().length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new ApplicationError('INVALID_JSON', 'Request body is not valid JSON', 400);
  }
}
