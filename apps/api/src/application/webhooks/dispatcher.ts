import type { PaymentOrder } from '../../domain/payment-order/index.js';
import { buildSignatureHeader } from '../../infrastructure/webhooks/signer.js';
import type {
  Clock,
  Logger,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookEventType,
  WebhookPayload,
  WebhookSender,
} from '../ports/index.js';
import { NOOP_LOGGER } from '../ports/index.js';

/**
 * Retry backoff schedule in seconds (spec 08 §5: 1m, 5m, 30m, 2h, 6h). A delivery is
 * attempted once immediately; each subsequent failure is rescheduled by the next interval
 * until the schedule is exhausted, after which it stays `failed` with no `next_retry_at`.
 */
export const WEBHOOK_BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_BACKOFF_SECONDS.length + 1;

export interface WebhookDispatcherDeps {
  deliveries: WebhookDeliveryRepository;
  sender: WebhookSender;
  clock: Clock;
  /** HMAC secret used to sign payloads (per-key secret in future; config secret in MVP). */
  signingSecret: string;
  logger?: Logger;
}

/**
 * Webhook dispatcher (TASK-022). Persists every attempt in `webhook_deliveries`, signs the
 * body (HMAC, spec 08 §5) and schedules retries with exponential backoff. The delivery row
 * id is minted **before** sending so the event id (`evt_<deliveryId>`) and `occurred_at`
 * stay stable across retries — consumers can dedupe even though the body is rebuilt.
 */
export class WebhookDispatcher {
  private readonly logger: Logger;

  constructor(private readonly deps: WebhookDispatcherDeps) {
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  /**
   * Emit `eventType` for `order` to its configured target (the order's `callback_url`).
   * Returns the delivery record, or `null` when the order has no webhook target.
   */
  async dispatch(
    order: PaymentOrder,
    eventType: WebhookEventType,
  ): Promise<WebhookDeliveryRecord | null> {
    const target = resolveTarget(order);
    if (!target) {
      return null;
    }
    const record = await this.deps.deliveries.create({
      paymentOrderId: order.id,
      eventType,
      targetUrl: target,
      attempt: 0,
      status: 'pending',
    });
    return this.attempt(record, order, 1);
  }

  /** Re-attempt a previously failed delivery (called by the worker for due retries). */
  async retry(record: WebhookDeliveryRecord, order: PaymentOrder): Promise<WebhookDeliveryRecord> {
    return this.attempt(record, order, record.attempt + 1);
  }

  private async attempt(
    record: WebhookDeliveryRecord,
    order: PaymentOrder,
    attempt: number,
  ): Promise<WebhookDeliveryRecord> {
    const payload = buildPayload(record, order);
    const body = JSON.stringify(payload);
    const ts = Math.floor(this.deps.clock.now().getTime() / 1000);
    const signature = buildSignatureHeader(this.deps.signingSecret, body, ts);

    const result = await this.deps.sender.send(record.targetUrl, body, signature);
    const status = result.ok ? 'delivered' : 'failed';
    const nextRetryAt = result.ok ? null : this.scheduleRetry(attempt);

    await this.deps.deliveries.update(record.id, {
      attempt,
      status,
      responseStatus: result.status,
      requestSignature: signature,
      nextRetryAt,
    });

    if (!result.ok) {
      this.logger.warn('webhook delivery failed', {
        deliveryId: record.id,
        paymentOrderId: order.id,
        attempt,
        responseStatus: result.status,
        willRetry: nextRetryAt !== null,
      });
    }

    return {
      ...record,
      attempt,
      status,
      responseStatus: result.status,
      requestSignature: signature,
      nextRetryAt,
    };
  }

  /** Next retry timestamp, or null once the backoff schedule is exhausted. */
  private scheduleRetry(attempt: number): Date | null {
    const delay = WEBHOOK_BACKOFF_SECONDS[attempt - 1];
    if (delay === undefined) {
      return null;
    }
    return new Date(this.deps.clock.now().getTime() + delay * 1000);
  }
}

/** The order's webhook target: the `callback_url` copied into its metadata (spec 08 §5). */
export function resolveTarget(order: PaymentOrder): string | null {
  const url = order.metadata['callback_url'];
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    return url;
  }
  return null;
}

function buildPayload(record: WebhookDeliveryRecord, order: PaymentOrder): WebhookPayload {
  const data: Record<string, unknown> = {
    payment_order_id: order.id,
    external_id: order.externalId,
    tenant_id: order.tenantId,
    status: order.status,
    blockchain_transaction_hash: order.blockchainTxHash,
  };
  if (order.paidAt) {
    data['paid_at'] = order.paidAt.toISOString();
  }
  return {
    event: record.eventType as WebhookEventType,
    id: `evt_${record.id}`,
    occurred_at: record.createdAt.toISOString(),
    data,
  };
}
