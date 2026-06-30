/** Parse `limit`/`offset` query params with sane bounds (spec 08 §2/§3 pagination). */
export function parsePagination(
  query: URLSearchParams,
  defaultLimit = 50,
  maxLimit = 200,
): { limit: number; offset: number } {
  const limit = clampInt(query.get('limit'), defaultLimit, 1, maxLimit);
  const offset = clampInt(query.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Read an optional, non-empty query string param. */
export function optionalParam(query: URLSearchParams, name: string): string | undefined {
  const value = query.get(name);
  return value && value.trim().length > 0 ? value : undefined;
}
