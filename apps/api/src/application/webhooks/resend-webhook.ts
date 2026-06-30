import type { OrderStatus } from '../../domain/payment-order/index.js';
import type { PaymentOrderRepository, WebhookEventType } from '../ports/index.js';
import { conflict, notFound, unprocessable } from '../shared/errors.js';
import type { WebhookDispatcher } from './dispatcher.js';

/** Map a terminal/active order status to its webhook event (spec 08 §5). */
const STATUS_EVENT: Partial<Record<OrderStatus, WebhookEventType>> = {
  ACTIVE: 'payment_order.registered',
  PAID: 'payment_order.paid',
  CANCELLED: 'payment_order.cancelled',
  EXPIRED: 'payment_order.expired',
  FAILED: 'payment_order.failed',
};

export interface ResendWebhookResult {
  deliveryId: string;
  eventType: WebhookEventType;
  status: string;
}

/**
 * Manually re-send the webhook for an order's current state (spec 08 §5 — POST
 * `/payment-orders/{id}/webhooks/resend`). A `CREATED` order has not produced an event yet
 * (`409`), and an order without a configured `callback_url` cannot be delivered (`422`).
 */
export class ResendWebhook {
  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  async execute(id: string): Promise<ResendWebhookResult> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { id });
    }

    const eventType = STATUS_EVENT[order.status];
    if (!eventType) {
      throw conflict('NO_WEBHOOK_EVENT', 'Order has not produced a webhook event yet', {
        status: order.status,
      });
    }

    const delivery = await this.dispatcher.dispatch(order, eventType);
    if (!delivery) {
      throw unprocessable('NO_WEBHOOK_TARGET', 'Order has no callback_url configured', { id });
    }

    return { deliveryId: delivery.id, eventType, status: delivery.status };
  }
}
