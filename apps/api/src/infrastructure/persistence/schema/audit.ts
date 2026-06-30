import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** `audit_logs` — cross-cutting audit trail of critical actions (spec 09 §7). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    correlationId: text('correlation_id'),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_entity').on(t.entityType, t.entityId),
    index('idx_audit_logs_actor').on(t.actorType, t.actorId),
    index('idx_audit_logs_created').on(t.createdAt),
  ],
);
