import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. Migrations are generated from the schema into
 * `src/infrastructure/persistence/migrations` and applied by `migrate.ts` (or the dedicated
 * migration service in Compose). Testnet/Postgres connection comes from `DATABASE_URL`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/infrastructure/persistence/schema/tenants.ts',
    './src/infrastructure/persistence/schema/payment-orders.ts',
    './src/infrastructure/persistence/schema/catalog.ts',
    './src/infrastructure/persistence/schema/webhooks.ts',
    './src/infrastructure/persistence/schema/audit.ts',
    './src/infrastructure/persistence/schema/access.ts',
  ],
  out: './src/infrastructure/persistence/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://payorder:payorder@localhost:5432/payorder',
  },
  strict: true,
  verbose: true,
});
