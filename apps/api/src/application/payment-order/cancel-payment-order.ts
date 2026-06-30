import type { Clock, PaymentOrderRepository } from '../ports/index.js';
import { notFound } from '../shared/errors.js';
import type { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { toPaymentOrderView, type PaymentOrderView } from './views.js';

export interface CancelPaymentOrderDeps {
  orders: PaymentOrderRepository;
  clock: Clock;
  publicWebUrl: string;
  /** Optional: emit a `payment_order.cancelled` webhook after a successful cancel. */
  webhooks?: WebhookDispatcher;
}

/**
 * Cancel an order (spec 08 §3, RN-08). Only `ACTIVE` orders are cancellable — the domain
 * state machine rejects any other status with `INVALID_STATE_TRANSITION` (422). On success
 * a `payment_order.cancelled` webhook is dispatched best-effort (failures are retried by the
 * worker and never block the response).
 */
export class CancelPaymentOrder {
  constructor(private readonly deps: CancelPaymentOrderDeps) {}

  async execute(id: string, by: string): Promise<PaymentOrderView> {
    const order = await this.deps.orders.findById(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { id });
    }

    order.cancel(by, this.deps.clock.now());
    await this.deps.orders.save(order);

    if (this.deps.webhooks) {
      await this.deps.webhooks.dispatch(order, 'payment_order.cancelled');
    }

    return toPaymentOrderView(order, this.deps.publicWebUrl);
  }
}
