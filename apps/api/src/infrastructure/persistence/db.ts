import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.js';

/**
 * PostgreSQL connection + Drizzle client (spec 04 §2.5, 09). The schema is passed in so the
 * relational query builder and types are available throughout the persistence layer.
 */
export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  readonly db: Database;
  readonly sql: Sql;
  /** Close the underlying connection pool. */
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool size. Migrations should use `max: 1`. */
  max?: number;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): DbHandle {
  const sql = postgres(connectionString, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
