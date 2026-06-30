import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * `payment_orders` — the charge lifecycle (spec 09 §2). `receiver_wallet_public_key` is a
 * copy of the tenant wallet, immutable after creation (RN-03). Idempotency by origin is
 * enforced by a partial unique index on `(tenant_id, external_id)`.
 */
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalId: text('external_id'),
    amount: numeric('amount', { precision: 20, scale: 7 }).notNull(),
    assetCode: text('asset_code').notNull(),
    assetIssuer: text('asset_issuer'),
    receiverWalletPublicKey: text('receiver_wallet_public_key').notNull(),
    canonicalPayloadHash: text('canonical_payload_hash').notNull(),
    status: text('status').notNull(),
    source: text('source').notNull().default('manual'),
    dueDate: date('due_date'),
    description: text('description'),
    publicPaymentSlug: text('public_payment_slug').notNull().unique(),
    sorobanContractId: text('soroban_contract_id'),
    blockchainTransactionHash: text('blockchain_transaction_hash'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_payment_orders_tenant').on(t.tenantId),
    index('idx_payment_orders_status').on(t.status),
    index('idx_payment_orders_due_date_active')
      .on(t.dueDate)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('idx_payment_orders_tx_hash').on(t.blockchainTransactionHash),
    index('idx_payment_orders_canonical_hash').on(t.canonicalPayloadHash),
    uniqueIndex('uq_payment_orders_tenant_external')
      .on(t.tenantId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    check('chk_payment_orders_amount_positive', sql`${t.amount} > 0`),
    check(
      'chk_payment_orders_status',
      sql`${t.status} IN ('CREATED','ACTIVE','PAID','EXPIRED','CANCELLED','FAILED')`,
    ),
  ],
);

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type NewPaymentOrderRow = typeof paymentOrders.$inferInsert;

/**
 * `payment_order_events` — lightweight event-sourcing trail (spec 09 §3) driving auditing,
 * public queries and webhooks.
 */
export const paymentOrderEvents = pgTable(
  'payment_order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_payment_order_events_order_created').on(t.paymentOrderId, t.createdAt),
    index('idx_payment_order_events_type').on(t.eventType),
  ],
);

export type PaymentOrderEventRow = typeof paymentOrderEvents.$inferSelect;
export type NewPaymentOrderEventRow = typeof paymentOrderEvents.$inferInsert;

/** `blockchain_transactions` — on-chain interaction records (spec 09 §5). */
export const blockchainTransactions = pgTable(
  'blockchain_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    kind: text('kind').notNull(),
    txHash: text('tx_hash'),
    ledger: bigint('ledger', { mode: 'number' }),
    status: text('status').notNull(),
    rawResult: jsonb('raw_result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_blockchain_tx_order').on(t.paymentOrderId),
    index('idx_blockchain_tx_hash').on(t.txHash),
    index('idx_blockchain_tx_status').on(t.status),
    check('chk_blockchain_tx_kind', sql`${t.kind} IN ('register','pay','cancel','expire')`),
    check(
      'chk_blockchain_tx_status',
      sql`${t.status} IN ('pending','submitted','success','failed')`,
    ),
  ],
);
