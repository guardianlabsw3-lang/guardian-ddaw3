import type {
  Clock,
  Logger,
  PaymentOrderRepository,
  WebhookDeliveryRepository,
} from '../ports/index.js';
import { NOOP_LOGGER } from '../ports/index.js';
import type { WebhookDispatcher } from './dispatcher.js';

export interface RetryDueWebhooksDeps {
  deliveries: WebhookDeliveryRepository;
  orders: PaymentOrderRepository;
  dispatcher: WebhookDispatcher;
  clock: Clock;
  logger?: Logger;
  /** Max deliveries to process per sweep. */
  batchSize?: number;
}

export interface RetrySweepResult {
  processed: number;
  delivered: number;
}

/**
 * Retry sweep for due webhook deliveries (TASK-022). Picks deliveries whose `next_retry_at`
 * has passed and re-attempts each via the dispatcher (which re-signs, persists the new
 * attempt and reschedules or gives up per the backoff). Runs on the worker's maintenance
 * schedule. A delivery whose order has disappeared is logged and skipped.
 */
export class RetryDueWebhooks {
  private readonly logger: Logger;

  constructor(private readonly deps: RetryDueWebhooksDeps) {
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async execute(): Promise<RetrySweepResult> {
    const due = await this.deps.deliveries.findDue(
      this.deps.clock.now(),
      this.deps.batchSize ?? 50,
    );
    let delivered = 0;
    for (const record of due) {
      const order = await this.deps.orders.findById(record.paymentOrderId);
      if (!order) {
        this.logger.warn('webhook retry: order not found, skipping', {
          deliveryId: record.id,
          paymentOrderId: record.paymentOrderId,
        });
        continue;
      }
      const updated = await this.deps.dispatcher.retry(record, order);
      if (updated.status === 'delivered') {
        delivered += 1;
      }
    }
    if (due.length > 0) {
      this.logger.info('webhook retry sweep complete', { processed: due.length, delivered });
    }
    return { processed: due.length, delivered };
  }
}
