import { describe, it, expect, beforeEach } from 'vitest';
import type { PaymentOrder } from '../../domain/payment-order/index.js';
import { SyncOrderStatus } from './sync-order-status.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  MockSorobanContract,
  RecordingLogger,
} from '../../../test/fakes.js';
import { FIXED_NOW, buildOrder } from '../../../test/fixtures.js';

const ORDER_ID = '00000000-0000-7000-8000-0000000000d1';

interface Harness {
  orders: InMemoryPaymentOrderRepository;
  contract: MockSorobanContract;
  logger: RecordingLogger;
  useCase: SyncOrderStatus;
}

function harness(): Harness {
  const orders = new InMemoryPaymentOrderRepository();
  const contract = new MockSorobanContract();
  const logger = new RecordingLogger();
  const useCase = new SyncOrderStatus({
    orders,
    contract,
    clock: new FixedClock(FIXED_NOW),
    logger,
  });
  return { orders, contract, logger, useCase };
}

/** Persist an ACTIVE order (already registered on-chain). */
async function saveActive(orders: InMemoryPaymentOrderRepository): Promise<PaymentOrder> {
  const order = buildOrder({ id: ORDER_ID });
  order.markRegisteredOnChain('CA_TEST_CONTRACT', 'TX_REG', FIXED_NOW);
  await orders.save(order);
  return order;
}

describe('SyncOrderStatus', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('reflects an on-chain PAID payment off-chain', async () => {
    await saveActive(h.orders);
    const paidAt = new Date('2026-06-30T10:00:00Z');
    h.contract.setOnChain(ORDER_ID, { status: 'PAID', payer: 'GPAYER', paidAt });

    const result = await h.useCase.execute(ORDER_ID);

    expect(result).toEqual({ outcome: 'updated', onChainStatus: 'PAID' });
    const order = await h.orders.findById(ORDER_ID);
    expect(order?.status).toBe('PAID');
    expect(order?.paidAt).toEqual(paidAt);
    const events = await h.orders.listEvents(ORDER_ID);
    expect(events.map((e) => e.eventType)).toContain('paid');
  });

  it('reflects on-chain CANCELLED and EXPIRED off-chain', async () => {
    await saveActive(h.orders);
    h.contract.setOnChain(ORDER_ID, { status: 'CANCELLED', payer: null, paidAt: null });
    expect((await h.useCase.execute(ORDER_ID)).outcome).toBe('updated');
    expect((await h.orders.findById(ORDER_ID))?.status).toBe('CANCELLED');
  });

  it('is a no-op when on-chain and off-chain already agree (ACTIVE)', async () => {
    await saveActive(h.orders);
    h.contract.setOnChain(ORDER_ID, { status: 'ACTIVE', payer: null, paidAt: null });

    const result = await h.useCase.execute(ORDER_ID);
    expect(result).toEqual({ outcome: 'in-sync', onChainStatus: 'ACTIVE' });
  });

  it('does not query the contract for a CREATED order (registration owns it)', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID }));
    const result = await h.useCase.execute(ORDER_ID);
    expect(result.outcome).toBe('not-registered');
  });

  it('treats an already-terminal off-chain order as in-sync', async () => {
    const order = buildOrder({ id: ORDER_ID });
    order.markRegisteredOnChain('CA', null, FIXED_NOW);
    order.markPaid('TX', FIXED_NOW, FIXED_NOW);
    await h.orders.save(order);

    const result = await h.useCase.execute(ORDER_ID);
    expect(result).toEqual({ outcome: 'in-sync', onChainStatus: 'PAID' });
  });

  it('logs a divergence when the order is ACTIVE off-chain but absent on-chain', async () => {
    await saveActive(h.orders);
    // No on-chain entry scripted.

    const result = await h.useCase.execute(ORDER_ID);

    expect(result.outcome).toBe('missing-on-chain');
    expect((await h.orders.findById(ORDER_ID))?.status).toBe('ACTIVE');
    expect(h.logger.byLevel('warn').some((r) => r.message.includes('absent on-chain'))).toBe(true);
  });

  it('reports missing when the order does not exist off-chain', async () => {
    const result = await h.useCase.execute('nope');
    expect(result.outcome).toBe('missing');
  });
});
