import { describe } from 'vitest';
import { createDb, runMigrations, type DbHandle } from '../src/infrastructure/persistence/index.js';

/**
 * Integration-test harness. Tests that need a real PostgreSQL are gated on `DATABASE_URL`
 * and skip themselves when it is absent (so unit-only CI stays green; spec 11 §5 expects a
 * real DB via Testcontainers in the integration suite). Locally, point `DATABASE_URL` at a
 * disposable database.
 */
export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

export async function setupDb(): Promise<DbHandle> {
  await runMigrations(TEST_DATABASE_URL);
  return createDb(TEST_DATABASE_URL, { max: 5 });
}

/** Wipe domain tables between tests (FK-safe order via CASCADE). */
export async function truncateAll(handle: DbHandle): Promise<void> {
  await handle.sql`TRUNCATE
    payment_order_events,
    blockchain_transactions,
    webhook_deliveries,
    payment_orders,
    tenants
    RESTART IDENTITY CASCADE`;
}
