/**
 * Webhook ports (spec 08 §5, spec 10 §6). Outbound events are signed with the integrator's
 * HMAC secret, delivered over HTTP, and every attempt is persisted with retry bookkeeping.
 */

/** Lifecycle events that produce a webhook (spec 08 §5). */
export type WebhookEventType =
  | 'payment_order.registered'
  | 'payment_order.paid'
  | 'payment_order.cancelled'
  | 'payment_order.expired'
  | 'payment_order.failed';

/** The signed JSON body delivered to the integrator (spec 08 §5 example). */
export interface WebhookPayload {
  event: WebhookEventType;
  id: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

/** Result of one HTTP delivery attempt. */
export interface WebhookSendResult {
  ok: boolean;
  status: number | null;
}

/** Sends a signed webhook over HTTP. Infrastructure implements this with `fetch`. */
export interface WebhookSender {
  send(target: string, body: string, signature: string): Promise<WebhookSendResult>;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

/** A persisted delivery attempt (spec 09 §6). */
export interface WebhookDeliveryRecord {
  id: string;
  paymentOrderId: string;
  eventType: string;
  targetUrl: string;
  attempt: number;
  status: WebhookDeliveryStatus;
  requestSignature: string | null;
  responseStatus: number | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookDeliveryInput {
  paymentOrderId: string;
  eventType: string;
  targetUrl: string;
  attempt: number;
  status: WebhookDeliveryStatus;
  requestSignature?: string | null;
  responseStatus?: number | null;
  nextRetryAt?: Date | null;
}

export interface WebhookDeliveryRepository {
  create(input: CreateWebhookDeliveryInput): Promise<WebhookDeliveryRecord>;
  /** Deliveries that are due for a retry (`failed`/`pending` with `next_retry_at <= now`). */
  findDue(now: Date, limit: number): Promise<WebhookDeliveryRecord[]>;
  update(
    id: string,
    patch: {
      attempt: number;
      status: WebhookDeliveryStatus;
      responseStatus?: number | null;
      requestSignature?: string | null;
      nextRetryAt?: Date | null;
    },
  ): Promise<void>;
  listByOrder(paymentOrderId: string): Promise<WebhookDeliveryRecord[]>;
}
