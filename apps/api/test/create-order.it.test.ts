import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { DbHandle } from '../src/infrastructure/persistence/index.js';
import {
  DrizzlePaymentOrderRepository,
  DrizzleTenantRepository,
} from '../src/infrastructure/persistence/index.js';
import {
  SystemClock,
  UuidV7IdGenerator,
  Base58SlugGenerator,
} from '../src/infrastructure/adapters/index.js';
import { InMemoryOrderRegistrationQueue } from '../src/infrastructure/queue/in-memory-order-registration-queue.js';
import { CreatePaymentOrder } from '../src/application/payment-order/index.js';
import {
  ActivateTenant,
  AssignTenantWallet,
  CreateTenant,
} from '../src/application/tenant/index.js';
import { describeDb, setupDb, truncateAll } from './db.js';
import { VALID_KEYS, VALID_CNPJ, expectAppError } from './fixtures.js';

/**
 * Full-stack integration of the product core (TASK-015) against a real PostgreSQL: onboard
 * a tenant → assign wallet → activate → create order only from tenant + amount → assert
 * persistence, the public slug, the enqueued registration job, idempotency and the
 * manual-wallet rejection. Skipped unless `DATABASE_URL` is set.
 */
describeDb('CreatePaymentOrder (PostgreSQL, end-to-end)', () => {
  let handle: DbHandle;
  let createOrder: CreatePaymentOrder;
  let queue: InMemoryOrderRegistrationQueue;
  let tenantsRepo: DrizzleTenantRepository;
  let ordersRepo: DrizzlePaymentOrderRepository;
  let tenantId: string;

  beforeAll(async () => {
    handle = await setupDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await truncateAll(handle);
    const ids = new UuidV7IdGenerator();
    const slugs = new Base58SlugGenerator();
    const clock = new SystemClock();
    tenantsRepo = new DrizzleTenantRepository(handle.db);
    ordersRepo = new DrizzlePaymentOrderRepository(handle.db);
    queue = new InMemoryOrderRegistrationQueue();

    const tenantView = await new CreateTenant(tenantsRepo, ids, slugs, clock).execute({
      name: 'ACME Pagamentos',
      legalName: 'ACME Pagamentos LTDA',
      document: { type: 'CNPJ', number: VALID_CNPJ },
      adminEmail: 'fin@acme.com.br',
      defaultAsset: { code: 'XLM', issuer: null },
    });
    tenantId = tenantView.id;
    await new AssignTenantWallet(tenantsRepo, ordersRepo, clock).execute(tenantId, {
      publicKey: VALID_KEYS[0],
      network: 'TESTNET',
    });
    await new ActivateTenant(tenantsRepo, clock).execute(tenantId);

    createOrder = new CreatePaymentOrder({
      tenants: tenantsRepo,
      orders: ordersRepo,
      ids,
      slugs,
      clock,
      registrationQueue: queue,
      publicWebUrl: 'http://localhost:3001',
    });
  });

  it('creates and persists an order from only tenant + amount, and enqueues registration', async () => {
    const view = await createOrder.execute({
      tenantId,
      amount: '150.00',
      dueDate: '2026-07-10',
      externalId: 'ORDER-1',
      description: 'Cobrança',
    });

    expect(view.status).toBe('CREATED');
    expect(view.receiverWalletPublicKey).toBe(VALID_KEYS[0]);
    expect(view.publicPaymentSlug).toMatch(/^p_[1-9A-HJ-NP-Za-km-z]{22}$/);

    const persisted = await ordersRepo.findById(view.id);
    expect(persisted?.amount).toBe('150.0000000');
    expect(persisted?.dueDate).toBe('2026-07-10');
    expect((await ordersRepo.listEvents(view.id)).map((e) => e.eventType)).toEqual(['created']);
    expect(queue.jobs).toEqual([{ paymentOrderId: view.id, correlationId: null }]);
  });

  it('is idempotent by (tenant_id, external_id) at the database level', async () => {
    const first = await createOrder.execute({ tenantId, amount: '150', externalId: 'DUP' });
    const second = await createOrder.execute({ tenantId, amount: '999', externalId: 'DUP' });
    expect(second.id).toBe(first.id);
    const list = await ordersRepo.list({ tenantId });
    expect(list.total).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('rejects a manually supplied wallet', async () => {
    await expectAppError(
      createOrder.execute({ tenantId, amount: '10', stellar_wallet_public_key: VALID_KEYS[1] }),
      'WALLET_NOT_ALLOWED_ON_ORDER',
      422,
    );
  });

  it('blocks a wallet change once an order exists (RN-09)', async () => {
    await createOrder.execute({ tenantId, amount: '10' });
    await expectAppError(
      new AssignTenantWallet(tenantsRepo, ordersRepo, new SystemClock()).execute(tenantId, {
        publicKey: VALID_KEYS[1],
        network: 'TESTNET',
      }),
      'WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS',
      409,
    );
  });
});
