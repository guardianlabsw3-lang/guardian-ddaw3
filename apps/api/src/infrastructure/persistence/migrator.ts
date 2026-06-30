import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type DbHandle } from './db.js';

/**
 * Apply all pending Drizzle migrations from `migrations/` (spec 09 §12 — versioned,
 * idempotent migrations run by a dedicated service in Compose). Safe to call repeatedly:
 * the migrator tracks applied migrations in `drizzle.__drizzle_migrations`.
 */
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(connectionString: string): Promise<void> {
  // A single connection is recommended for DDL.
  const handle: DbHandle = createDb(connectionString, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}
