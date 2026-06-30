import { describe, it, expect, beforeEach } from 'vitest';
import type { PaymentOrder } from '../../domain/payment-order/index.js';
import { ExpireOrders } from './expire-orders.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  RecordingLogger,
} from '../../../test/fakes.js';
import { FIXED_NOW, buildOrder } from '../../../test/fixtures.js';

interface Harness {
  orders: InMemoryPaymentOrderRepository;
  clock: FixedClock;
  logger: RecordingLogger;
  useCase: ExpireOrders;
}

function harness(): Harness {
  const orders = new InMemoryPaymentOrderRepository();
  const clock = new FixedClock(FIXED_NOW);
  const logger = new RecordingLogger();
  return { orders, clock, logger, useCase: new ExpireOrders({ orders, clock, logger }) };
}

/** Persist an ACTIVE order with the given due date. */
async function saveActive(
  orders: InMemoryPaymentOrderRepository,
  id: string,
  dueDate: string | null,
): Promise<PaymentOrder> {
  const order = buildOrder({ id, dueDate });
  order.markRegisteredOnChain('CA', null, FIXED_NOW);
  await orders.save(order);
  return order;
}

const PAST = '2020-01-01';
const FUTURE = '2030-01-01';

describe('ExpireOrders', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('expires only ACTIVE orders past their due date', async () => {
    await saveActive(h.orders, 'order-past', PAST);
    await saveActive(h.orders, 'order-future', FUTURE);
    await saveActive(h.orders, 'order-no-due', null);
    // A CREATED (not yet active) order is never expired by this job.
    await h.orders.save(buildOrder({ id: 'order-created', dueDate: PAST }));

    const result = await h.useCase.execute();

    expect(result.expired).toBe(1);
    expect((await h.orders.findById('order-past'))?.status).toBe('EXPIRED');
    expect((await h.orders.findById('order-future'))?.status).toBe('ACTIVE');
    expect((await h.orders.findById('order-no-due'))?.status).toBe('ACTIVE');
    expect((await h.orders.findById('order-created'))?.status).toBe('CREATED');

    const events = await h.orders.listEvents('order-past');
    expect(events.map((e) => e.eventType)).toContain('expired');
  });

  it('respects the injected clock: nothing expires before the due date', async () => {
    await saveActive(h.orders, 'order-1', '2026-12-31');
    h.clock.set(new Date('2026-06-30T12:00:00Z')); // before due

    const result = await h.useCase.execute();
    expect(result.expired).toBe(0);
    expect((await h.orders.findById('order-1'))?.status).toBe('ACTIVE');

    // Advance past the due date and re-run.
    h.clock.set(new Date('2027-01-02T00:00:00Z'));
    const after = await h.useCase.execute();
    expect(after.expired).toBe(1);
    expect((await h.orders.findById('order-1'))?.status).toBe('EXPIRED');
  });

  it('pages through many due orders and expires them all', async () => {
    for (let i = 0; i < 7; i += 1) {
      await saveActive(h.orders, `order-${i}`, PAST);
    }

    const result = await h.useCase.execute(2); // small page size to force pagination

    expect(result.expired).toBe(7);
    for (let i = 0; i < 7; i += 1) {
      expect((await h.orders.findById(`order-${i}`))?.status).toBe('EXPIRED');
    }
  });
});
