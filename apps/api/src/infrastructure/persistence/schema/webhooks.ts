import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { paymentOrders } from './payment-orders.js';

/** `webhook_deliveries` — outbound webhook attempts with retry bookkeeping (spec 09 §6). */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    eventType: text('event_type').notNull(),
    targetUrl: text('target_url').notNull(),
    attempt: integer('attempt').notNull().default(0),
    status: text('status').notNull(),
    requestSignature: text('request_signature'),
    responseStatus: integer('response_status'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_webhook_deliveries_order').on(t.paymentOrderId),
    index('idx_webhook_deliveries_status_retry').on(t.status, t.nextRetryAt),
  ],
);
