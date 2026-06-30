import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `accepted_assets` — catalog of accepted Testnet assets (spec 09 §4). Enables validating
 * `asset_code/issuer` and a future multi-asset story without schema changes.
 */
export const acceptedAssets = pgTable(
  'accepted_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    issuer: text('issuer'),
    network: text('network').notNull().default('TESTNET'),
    sacAddress: text('sac_address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // UNIQUE(code, issuer, network) — `issuer` NULL means native XLM; coalesce so the
    // native row is unique per (code, network).
    uniqueIndex('uq_accepted_assets_code_issuer_network').on(
      t.code,
      sql`coalesce(${t.issuer}, '')`,
      t.network,
    ),
  ],
);

export type AcceptedAssetRow = typeof acceptedAssets.$inferSelect;
export type NewAcceptedAssetRow = typeof acceptedAssets.$inferInsert;
