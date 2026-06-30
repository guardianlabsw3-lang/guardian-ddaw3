/**
 * Idempotency store port (spec 08 §4, spec 09 §10). A successful, non-error response to an
 * idempotent endpoint is memorized by `(key, endpoint)` for a TTL window. A replay with the
 * same body returns the stored response; a replay with a divergent body is a conflict.
 */
export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

export interface IdempotencyStore {
  find(key: string, endpoint: string): Promise<IdempotencyRecord | null>;
  /** Persist the response for a key; `ttlSeconds` sets the expiry window. */
  save(
    key: string,
    endpoint: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
    ttlSeconds: number,
  ): Promise<void>;
}
