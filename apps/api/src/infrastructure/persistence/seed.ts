import { ActivateTenant, AssignTenantWallet, CreateTenant } from '../../application/index.js';
import { Base58SlugGenerator, SystemClock, UuidV7IdGenerator } from '../adapters/index.js';
import { Argon2PasswordHasher, DrizzleAdminUserRepository } from '../auth/index.js';
import { loadConfig } from '../config/index.js';
import { createDb } from './db.js';
import { DrizzlePaymentOrderRepository, DrizzleTenantRepository } from './index.js';

/**
 * Local development seed (TASK-027). Populates the minimum data needed to exercise the
 * product end to end without touching the chain: one admin user (so the admin panel login
 * works) and one **active tenant with a destination wallet** — which is the only precondition
 * for "create a payment order with just tenant + amount" (RN-01).
 *
 * The seed is **idempotent**: it skips records that already exist, so `make seed` can be run
 * repeatedly. It reuses the real use cases / repositories so the seeded data is identical to
 * what the API would produce. Values are overridable via `SEED_*` env vars; the defaults are
 * safe Testnet placeholders and must never be used outside local development.
 */

const SEED = {
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@payorder.local',
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'changeme123',
  tenantName: process.env.SEED_TENANT_NAME ?? 'Acme Demo',
  tenantLegalName: process.env.SEED_TENANT_LEGAL_NAME ?? 'Acme Demo LTDA',
  tenantDocument: process.env.SEED_TENANT_DOCUMENT ?? '11222333000181',
  tenantEmail: process.env.SEED_TENANT_EMAIL ?? 'owner@acme.local',
  // A funded Stellar Testnet account is not required for the seed itself — the wallet is only
  // stored as the order's destination. Override with a wallet you control to pay on-chain.
  walletPublicKey:
    process.env.SEED_TENANT_WALLET ?? 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
} as const;

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.database.url, { max: 1 });

  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator();
  const slugs = new Base58SlugGenerator();
  const tenants = new DrizzleTenantRepository(handle.db);
  const orders = new DrizzlePaymentOrderRepository(handle.db);
  const adminUsers = new DrizzleAdminUserRepository(handle.db);
  const hasher = new Argon2PasswordHasher();

  try {
    // 1. Admin user (idempotent by email).
    const existingAdmin = await adminUsers.findByEmail(SEED.adminEmail);
    if (existingAdmin) {
      console.log(`• admin user already exists: ${SEED.adminEmail}`);
    } else {
      await adminUsers.create({
        email: SEED.adminEmail,
        passwordHash: await hasher.hash(SEED.adminPassword),
        role: 'admin',
      });
      console.log(`✓ created admin user: ${SEED.adminEmail} (password: ${SEED.adminPassword})`);
    }

    // 2. Tenant (idempotent by document) with wallet, activated.
    let tenantId: string;
    const existingTenant = await tenants.findByDocument(SEED.tenantDocument);
    if (existingTenant) {
      tenantId = existingTenant.id;
      console.log(`• tenant already exists: ${existingTenant.slug} (${tenantId})`);
    } else {
      const created = await new CreateTenant(tenants, ids, slugs, clock).execute({
        name: SEED.tenantName,
        legalName: SEED.tenantLegalName,
        document: { type: 'CNPJ', number: SEED.tenantDocument },
        adminEmail: SEED.tenantEmail,
        defaultAsset: { code: 'XLM', issuer: null },
      });
      tenantId = created.id;
      console.log(`✓ created tenant: ${created.slug} (${tenantId})`);
    }

    await new AssignTenantWallet(tenants, orders, clock).execute(tenantId, {
      publicKey: SEED.walletPublicKey,
      network: 'TESTNET',
    });
    console.log(`✓ tenant wallet set: ${SEED.walletPublicKey}`);

    const activated = await new ActivateTenant(tenants, clock).execute(tenantId);
    console.log(`✓ tenant status: ${activated.status}`);

    console.log('\nSeed complete. Create an order with just this tenant + an amount.');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
