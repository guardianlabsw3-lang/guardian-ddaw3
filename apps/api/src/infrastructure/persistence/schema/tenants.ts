import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `tenants` — receiver identity + destination wallet (spec 09 §1). The principal wallet
 * lives here (ADR-04); there is no separate `tenant_wallets` table in the MVP.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    documentType: text('document_type').notNull(),
    documentNumber: text('document_number').notNull().unique(),
    adminEmail: text('admin_email').notNull(),
    stellarWalletPublicKey: text('stellar_wallet_public_key'),
    stellarNetwork: text('stellar_network').notNull().default('TESTNET'),
    defaultAssetCode: text('default_asset_code').notNull(),
    defaultAssetIssuer: text('default_asset_issuer'),
    status: text('status').notNull().default('INACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_tenants_status').on(t.status),
    check('chk_tenants_document_type', sql`${t.documentType} IN ('CNPJ','CPF','OTHER')`),
    check('chk_tenants_status', sql`${t.status} IN ('ACTIVE','INACTIVE')`),
    check('chk_tenants_network', sql`${t.stellarNetwork} = 'TESTNET'`),
    check(
      'chk_tenants_wallet_format',
      sql`${t.stellarWalletPublicKey} IS NULL OR ${t.stellarWalletPublicKey} ~ '^G[A-Z2-7]{55}$'`,
    ),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;
