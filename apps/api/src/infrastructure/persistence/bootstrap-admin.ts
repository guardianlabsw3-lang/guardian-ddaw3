import { Argon2PasswordHasher, DrizzleAdminUserRepository } from '../auth/index.js';
import { loadConfig } from '../config/index.js';
import { createDb } from './db.js';
import { ensureAdminUser } from './ensure-admin.js';

/**
 * Production bootstrap: create the **first admin panel account** from `SEED_ADMIN_EMAIL` /
 * `SEED_ADMIN_PASSWORD`, idempotently. Unlike the local `seed`, it creates **no** demo tenant —
 * it only makes the panel loginable on a fresh deploy. Meant to run as a one-shot right after
 * migrations (see the `bootstrap-admin` compose service / the CI deploy job):
 *
 *   - both vars unset      → skip (exit 0) so deploys that don't need it still succeed;
 *   - only one set         → fail loudly (a half-configured credential is a mistake);
 *   - account exists        → skip, never resetting the password;
 *   - otherwise            → create the admin.
 *
 * This admin is normally the root/first-deploy login (`ROOT_ADMIN_EMAIL`) with unrestricted
 * tenant visibility; every other admin login is scoped to its own tenant.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email && !password) {
    console.log(
      'bootstrap-admin: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping first-admin bootstrap.',
    );
    return;
  }
  if (!email || !password) {
    throw new Error(
      'bootstrap-admin: set BOTH SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (or neither).',
    );
  }

  const config = loadConfig();
  const handle = createDb(config.database.url, { max: 1 });
  try {
    const admins = new DrizzleAdminUserRepository(handle.db);
    const hasher = new Argon2PasswordHasher();
    const result = await ensureAdminUser(admins, hasher, { email, password, role: 'admin' });
    console.log(
      result.created
        ? `bootstrap-admin: created admin ${result.email}.`
        : `bootstrap-admin: admin ${result.email} already exists — nothing to do.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
