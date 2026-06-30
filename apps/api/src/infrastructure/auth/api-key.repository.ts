import { eq } from 'drizzle-orm';
import type { ApiKeyRecord, ApiKeyRepository } from '../../application/ports/index.js';
import type { Database } from '../persistence/db.js';
import { apiKeys } from '../persistence/schema/access.js';

/** Drizzle-backed `ApiKeyRepository` over `api_keys` (spec 09 §9). */
export class DrizzleApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Database) {}

  async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefix))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async create(record: {
    name: string;
    keyPrefix: string;
    keyHash: string;
    webhookSecretHash?: string | null;
    scopes: string[];
    allowedTenantIds?: string[] | null;
  }): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        name: record.name,
        keyPrefix: record.keyPrefix,
        keyHash: record.keyHash,
        webhookSecretHash: record.webhookSecretHash ?? null,
        scopes: record.scopes,
        allowedTenantIds: record.allowedTenantIds ?? null,
      })
      .returning();
    return toRecord(row!);
  }
}

function toRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    keyHash: row.keyHash,
    webhookSecretHash: row.webhookSecretHash,
    scopes: row.scopes,
    allowedTenantIds: row.allowedTenantIds,
    isActive: row.isActive,
  };
}
