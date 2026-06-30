import { and, eq, gt } from 'drizzle-orm';
import type { IdempotencyRecord, IdempotencyStore } from '../../application/ports/index.js';
import type { Database } from '../persistence/db.js';
import { idempotencyKeys } from '../persistence/schema/access.js';

/**
 * Drizzle-backed idempotency store over `idempotency_keys` (spec 09 §10). Records expire by
 * `expires_at`; `find` ignores expired rows so a key can be reused after its TTL. Writes use
 * `onConflictDoNothing` so a race between two identical concurrent requests stores exactly
 * one response.
 */
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async find(key: string, endpoint: string): Promise<IdempotencyRecord | null> {
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.endpoint, endpoint),
          gt(idempotencyKeys.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row || row.responseStatus === null) {
      return null;
    }
    return {
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
    };
  }

  async save(
    key: string,
    endpoint: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.db
      .insert(idempotencyKeys)
      .values({
        key,
        endpoint,
        requestHash,
        responseStatus,
        responseBody: responseBody as Record<string, unknown>,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      })
      .onConflictDoNothing({ target: [idempotencyKeys.key, idempotencyKeys.endpoint] });
  }
}
