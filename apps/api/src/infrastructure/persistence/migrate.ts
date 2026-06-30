import { loadConfig } from '../config/index.js';
import { runMigrations } from './migrator.js';

/**
 * CLI entrypoint: `npm run db:migrate`. Loads/validates the environment (Testnet-locked)
 * and applies pending migrations, then exits.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  await runMigrations(config.database.url);
  console.log('Migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
