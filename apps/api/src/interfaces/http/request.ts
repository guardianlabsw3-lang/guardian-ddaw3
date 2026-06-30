import { parseJsonBody } from './types.js';
import type { HttpRequest } from './types.js';

export interface RawRequest {
  method: string;
  /** Full request URL or path+query (e.g. `/api/tenants?status=ACTIVE`). */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: string;
}

/**
 * Build the normalized `HttpRequest` consumed by the pipeline. Header names are lower-cased
 * and multi-value headers joined; the body is parsed lazily and memoized by `json()`. Shared
 * by the node server adapter and by tests (which can drive the app without a socket).
 */
export function createHttpRequest(raw: RawRequest): HttpRequest {
  const url = new URL(raw.url, 'http://internal');
  const headers = normalizeHeaders(raw.headers);
  const rawBody = raw.rawBody ?? '';
  let cached: unknown;
  let parsed = false;

  return {
    method: raw.method.toUpperCase(),
    path: url.pathname,
    query: url.searchParams,
    headers,
    rawBody,
    params: {},
    requestId: '',
    principal: undefined,
    route: undefined,
    json<T = unknown>(): T {
      if (!parsed) {
        cached = parseJsonBody(rawBody);
        parsed = true;
      }
      return cached as T;
    },
  };
}

function normalizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}
