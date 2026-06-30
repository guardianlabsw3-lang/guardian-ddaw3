import type { OrderStatus, PaymentOrder } from '../../domain/payment-order/index.js';
import type { Page } from './tenant-repository.js';

export interface PaymentOrderListFilter {
  tenantId?: string;
  status?: OrderStatus;
  externalId?: string;
  limit?: number;
  offset?: number;
}

/** A persisted payment-order event (spec 09 §3), as returned to the application for queries. */
export interface PaymentOrderEventRecord {
  id: string;
  paymentOrderId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  createdAt: Date;
}

/**
 * `PaymentOrderRepository` port (spec 03 §7). `save` upserts the order and appends any
 * events pulled from the aggregate, in a single transaction, so the order and its trail
 * never diverge. The immutable columns (RN-03/RN-04) are written once at insert time.
 */
export interface PaymentOrderRepository {
  save(order: PaymentOrder): Promise<void>;
  findById(id: string): Promise<PaymentOrder | null>;
  findBySlug(slug: string): Promise<PaymentOrder | null>;
  findByTenantAndExternalId(tenantId: string, externalId: string): Promise<PaymentOrder | null>;
  listEvents(orderId: string): Promise<PaymentOrderEventRecord[]>;
  /**
   * Count orders that block a tenant wallet change (RN-09): those still `CREATED` or
   * `ACTIVE`.
   */
  countOpenByTenant(tenantId: string): Promise<number>;
  list(filter: PaymentOrderListFilter): Promise<Page<PaymentOrder>>;
}
