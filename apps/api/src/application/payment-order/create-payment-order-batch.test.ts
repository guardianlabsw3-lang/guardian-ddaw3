import { describe, it, expect, beforeEach } from 'vitest';
import {
  CreatePaymentOrderBatch,
  MAX_BATCH_SIZE,
  mapWithConcurrency,
} from './create-payment-order-batch.js';
import { CreatePaymentOrder, type CreatePaymentOrderDeps } from './create-payment-order.js';
import { InMemoryOrderRegistrationQueue } from '../../infrastructure/queue/in-memory-order-registration-queue.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  RecordingLogger,
  StubIdGenerator,
  StubSlugGenerator,
} from '../../../test/fakes.js';
import { FIXED_NOW, VALID_CNPJ, buildTenant, expectAppError } from '../../../test/fixtures.js';

const PUBLIC_WEB_URL = 'http://localhost:3001';
const TENANT_1 = '00000000-0000-7000-8000-0000000000a1';

interface Harness extends CreatePaymentOrderDeps {
  tenants: InMemoryTenantRepository;
  orders: InMemoryPaymentOrderRepository;
  registrationQueue: InMemoryOrderRegistrationQueue;
}

function harness(): Harness {
  return {
    tenants: new InMemoryTenantRepository(),
    orders: new InMemoryPaymentOrderRepository(),
    ids: new StubIdGenerator('order'),
    slugs: new StubSlugGenerator(),
    clock: new FixedClock(FIXED_NOW),
    registrationQueue: new InMemoryOrderRegistrationQueue(),
    publicWebUrl: PUBLIC_WEB_URL,
  };
}

describe('CreatePaymentOrderBatch', () => {
  let h: Harness;
  let logger: RecordingLogger;
  let batch: CreatePaymentOrderBatch;

  beforeEach(async () => {
    h = harness();
    logger = new RecordingLogger();
    batch = new CreatePaymentOrderBatch(new CreatePaymentOrder(h), logger);
    await h.tenants.save(buildTenant({ id: TENANT_1, slug: 'acme', documentNumber: VALID_CNPJ }));
  });

  it('creates every item and preserves input order', async () => {
    const result = await batch.execute({
      orders: [
        { tenantId: TENANT_1, amount: '10', externalId: 'B-1' },
        { tenantId: TENANT_1, amount: '20', externalId: 'B-2' },
        { tenantId: TENANT_1, amount: '30', externalId: 'B-3' },
      ],
    });

    expect(result.summary).toEqual({ total: 3, created: 3, failed: 0 });
    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(result.results.every((r) => r.ok)).toBe(true);
    const amounts = result.results.map((r) => (r.ok ? r.order.amount : null));
    expect(amounts).toEqual(['10.0000000', '20.0000000', '30.0000000']);
    expect(h.orders.store.size).toBe(3);
  });

  it('dedupes concurrent items sharing (tenant, external_id) instead of racing into duplicates', async () => {
    // CreatePaymentOrder's natural dedup is a check-then-act read+save; without the batch
    // orchestrator's own serialization, running these two concurrently would let both see
    // "not found" and create two separate orders for the same external_id.
    const result = await batch.execute({
      orders: Array.from({ length: 5 }, () => ({
        tenantId: TENANT_1,
        amount: '10',
        externalId: 'RACE-1',
      })),
    });

    expect(result.summary).toEqual({ total: 5, created: 5, failed: 0 });
    const ids = result.results.map((r) => (r.ok ? r.order.id : null));
    expect(new Set(ids).size).toBe(1); // every item resolved to the same, single order
    expect(h.orders.store.size).toBe(1);
  });

  it('isolates a failing item without aborting the others, preserving index-to-error mapping', async () => {
    const result = await batch.execute({
      orders: [
        { tenantId: TENANT_1, amount: '10', externalId: 'OK-1' },
        { tenantId: '00000000-0000-7000-8000-0000000000ff', amount: '10' }, // TENANT_NOT_FOUND
        { tenantId: TENANT_1, amount: '10', externalId: 'OK-2' },
        { tenantId: TENANT_1, amount: '10', stellar_wallet_public_key: 'GABC' }, // WALLET_NOT_ALLOWED_ON_ORDER
      ],
    });

    expect(result.summary).toEqual({ total: 4, created: 2, failed: 2 });
    expect(result.results[0]).toMatchObject({ index: 0, ok: true });
    expect(result.results[1]).toMatchObject({
      index: 1,
      ok: false,
      error: { code: 'TENANT_NOT_FOUND' },
    });
    expect(result.results[2]).toMatchObject({ index: 2, ok: true });
    expect(result.results[3]).toMatchObject({
      index: 3,
      ok: false,
      error: { code: 'WALLET_NOT_ALLOWED_ON_ORDER' },
    });
    expect(h.orders.store.size).toBe(2);
  });

  it('rejects an empty batch (BATCH_EMPTY) without creating anything', async () => {
    await expectAppError(batch.execute({ orders: [] }), 'BATCH_EMPTY', 422);
    expect(h.orders.store.size).toBe(0);
  });

  it(`rejects a batch over ${MAX_BATCH_SIZE} items (BATCH_TOO_LARGE) without creating anything`, async () => {
    const orders = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      tenantId: TENANT_1,
      amount: '10',
      externalId: `OVER-${i}`,
    }));
    await expectAppError(batch.execute({ orders }), 'BATCH_TOO_LARGE', 422);
    expect(h.orders.store.size).toBe(0);
  });

  it('logs and isolates a truly unexpected (non-Application/Domain) error as INTERNAL_ERROR', async () => {
    const throwing = new CreatePaymentOrder(h);
    throwing.execute = async () => {
      throw new Error('boom');
    };
    const boomBatch = new CreatePaymentOrderBatch(throwing, logger);

    const result = await boomBatch.execute({
      orders: [{ tenantId: TENANT_1, amount: '10' }],
    });

    expect(result.summary).toEqual({ total: 1, created: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    // The unexpected error is logged server-side, not leaked to the item's error message.
    expect(logger.byLevel('error')).toHaveLength(1);
    expect((result.results[0] as { error: { message: string } }).error.message).not.toContain(
      'boom',
    );
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `concurrency` items at once and preserves output order', async () => {
    const delays = [8, 1, 5, 2, 7, 3, 6, 4];
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency(delays, 3, async (delay, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return { index, delay };
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(results).toEqual(delays.map((delay, index) => ({ index, delay })));
  });

  it('handles an empty input', async () => {
    const results = await mapWithConcurrency([], 5, async () => 'never');
    expect(results).toEqual([]);
  });
});
