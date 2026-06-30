import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { DbHandle } from '../src/infrastructure/persistence/index.js';
import {
  DrizzlePaymentOrderRepository,
  DrizzleTenantRepository,
} from '../src/infrastructure/persistence/index.js';
import { describeDb, setupDb, truncateAll } from './db.js';
import { buildOrder, buildTenant, testnetAccount, OTHER_WALLET, VALID_KEYS } from './fixtures.js';

/**
 * Repository integration tests against a real PostgreSQL (spec 11 §5). Skipped unless
 * `DATABASE_URL` is set. Covers CRUD, the resolution queries (slug/document/external_id),
 * the `(tenant_id, external_id)` uniqueness/idempotency constraint, event persistence and
 * the open-orders count behind the wallet-change block (RN-09).
 */
describeDb('persistence (PostgreSQL)', () => {
  let handle: DbHandle;
  let tenants: DrizzleTenantRepository;
  let orders: DrizzlePaymentOrderRepository;

  beforeAll(async () => {
    handle = await setupDb();
    tenants = new DrizzleTenantRepository(handle.db);
    orders = new DrizzlePaymentOrderRepository(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await truncateAll(handle);
  });

  it('saves and resolves a tenant by id, slug and document', async () => {
    const tenant = buildTenant({ slug: 'acme-pagamentos', documentNumber: '11222333000181' });
    await tenants.save(tenant);

    expect((await tenants.findById(tenant.id))?.id).toBe(tenant.id);
    expect((await tenants.findBySlug('acme-pagamentos'))?.id).toBe(tenant.id);
    const byDoc = await tenants.findByDocument('11222333000181');
    expect(byDoc?.canIssueOrders()).toBe(true);
    expect(await tenants.existsByDocument('11222333000181')).toBe(true);
    expect(await tenants.existsBySlug('nope')).toBe(false);
  });

  it('upserts a tenant on wallet change and round-trips the new wallet', async () => {
    const tenant = buildTenant({ withWallet: true });
    await tenants.save(tenant);

    tenant.assignWallet(testnetAccount(VALID_KEYS[1]), new Date('2026-07-01T00:00:00Z'));
    await tenants.save(tenant);

    const reloaded = await tenants.findById(tenant.id);
    expect(reloaded?.wallet?.publicKey).toBe(OTHER_WALLET);
  });

  it('lists tenants filtered by status', async () => {
    await tenants.save(buildTenant({ documentNumber: '11222333000181', active: true }));
    await tenants.save(
      buildTenant({ documentNumber: '11444777000161', active: false, withWallet: false }),
    );

    const active = await tenants.list({ status: 'ACTIVE' });
    expect(active.total).toBe(1);
    expect(active.items[0]!.status).toBe('ACTIVE');
  });

  it('persists an order with its created event and resolves it', async () => {
    const tenant = buildTenant();
    await tenants.save(tenant);

    const order = buildOrder({
      tenantId: tenant.id,
      externalId: 'ORDER-1',
      publicSlug: 'p_abc123def456ghi789jkl0',
    });
    await orders.save(order);

    const byId = await orders.findById(order.id);
    expect(byId?.status).toBe('CREATED');
    expect(byId?.receiverWallet).toBe(order.receiverWallet);
    expect(byId?.canonicalPayloadHash).toBe(order.canonicalPayloadHash);

    expect((await orders.findBySlug('p_abc123def456ghi789jkl0'))?.id).toBe(order.id);
    expect((await orders.findByTenantAndExternalId(tenant.id, 'ORDER-1'))?.id).toBe(order.id);

    const events = await orders.listEvents(order.id);
    expect(events.map((e) => e.eventType)).toEqual(['created']);
  });

  it('enforces (tenant_id, external_id) uniqueness', async () => {
    const tenant = buildTenant();
    await tenants.save(tenant);
    await orders.save(buildOrder({ tenantId: tenant.id, externalId: 'DUP' }));

    await expect(
      orders.save(buildOrder({ tenantId: tenant.id, externalId: 'DUP' })),
    ).rejects.toThrow();
  });

  it('allows multiple orders with NULL external_id for the same tenant', async () => {
    const tenant = buildTenant();
    await tenants.save(tenant);
    await orders.save(buildOrder({ tenantId: tenant.id, externalId: null }));
    await orders.save(buildOrder({ tenantId: tenant.id, externalId: null }));
    const list = await orders.list({ tenantId: tenant.id });
    expect(list.total).toBe(2);
  });

  it('appends events and updates status on a lifecycle transition', async () => {
    const tenant = buildTenant();
    await tenants.save(tenant);
    const order = buildOrder({ tenantId: tenant.id });
    await orders.save(order);

    const loaded = (await orders.findById(order.id))!;
    loaded.markRegisteredOnChain('CA_CONTRACT', 'TX_HASH', new Date('2026-06-30T13:00:00Z'));
    await orders.save(loaded);

    const reloaded = (await orders.findById(order.id))!;
    expect(reloaded.status).toBe('ACTIVE');
    expect(reloaded.sorobanContractId).toBe('CA_CONTRACT');
    const events = await orders.listEvents(order.id);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'registered']);
  });

  it('counts only CREATED/ACTIVE orders behind the wallet-change block', async () => {
    const tenant = buildTenant();
    await tenants.save(tenant);

    const created = buildOrder({ tenantId: tenant.id, externalId: 'A' });
    await orders.save(created);
    expect(await orders.countOpenByTenant(tenant.id)).toBe(1);

    created.markRegisteredOnChain('CA', null, new Date());
    created.cancel('admin', new Date());
    await orders.save(created);
    expect(await orders.countOpenByTenant(tenant.id)).toBe(0);
  });
});
