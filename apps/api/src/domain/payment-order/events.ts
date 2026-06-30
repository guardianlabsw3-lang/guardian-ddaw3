/**
 * PaymentOrder domain events (spec 03 §6). `type` matches the persisted
 * `payment_order_events.event_type` enum (spec 09 §3) so the repository can store them
 * directly. `payload` carries non-sensitive fields and is serialized as JSONB.
 */
export const PAYMENT_ORDER_EVENT_TYPES = [
  'created',
  'registered',
  'paid',
  'cancelled',
  'expired',
  'failed',
] as const;

export type PaymentOrderEventType = (typeof PAYMENT_ORDER_EVENT_TYPES)[number];

export interface PaymentOrderEvent {
  type: PaymentOrderEventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
}
