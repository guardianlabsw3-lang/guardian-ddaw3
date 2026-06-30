import type { PaymentOrder } from '../../domain/payment-order/index.js';
import type { Clock, Logger, PaymentOrderRepository } from '../ports/index.js';

/**
 * TASK-017 — expire `ACTIVE` orders whose due date has passed (UC-09).
 *
 * Expiration is objectively verifiable off-chain (`PaymentOrder.isPastDue`), so the worker
 * transitions due orders to `EXPIRED` without a round-trip to the contract. `Clock` is
 * injected so the boundary is deterministic under test. Orders are scanned in pages to bound
 * memory; each page is re-fetched from the head because expiring removes rows from the
 * `ACTIVE` set.
 */
export interface ExpireOrdersDeps {
  orders: PaymentOrderRepository;
  clock: Clock;
  logger: Logger;
}

export interface ExpireOrdersResult {
  scanned: number;
  expired: number;
}

const DEFAULT_PAGE_SIZE = 100;

export class ExpireOrders {
  constructor(private readonly deps: ExpireOrdersDeps) {}

  async execute(pageSize = DEFAULT_PAGE_SIZE): Promise<ExpireOrdersResult> {
    const { orders, clock, logger } = this.deps;
    const now = clock.now();
    let scanned = 0;
    let expired = 0;
    let offset = 0;

    for (;;) {
      const page = await orders.list({ status: 'ACTIVE', limit: pageSize, offset });
      if (page.items.length === 0) {
        break;
      }

      const due = page.items.filter((order) => order.isPastDue(now));
      scanned += page.items.length;

      for (const order of due) {
        this.expireOne(order, now, logger);
        await orders.save(order);
        expired += 1;
      }

      // Expired rows leave the ACTIVE set, so advance only by the rows we kept this page.
      offset += page.items.length - due.length;
      if (page.items.length < pageSize) {
        break;
      }
    }

    if (expired > 0) {
      logger.info('expire-orders: expired due orders', { scanned, expired });
    }
    return { scanned, expired };
  }

  private expireOne(order: PaymentOrder, now: Date, logger: Logger): void {
    order.expire(now);
    logger.info('expire-orders: order expired', {
      paymentOrderId: order.id,
      dueDate: order.dueDate,
      correlationId: order.correlationId,
    });
  }
}
