import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { OrderStatus, PaymentOrder } from '../../domain/payment-order/index.js';
import type {
  Page,
  PaymentOrderEventRecord,
  PaymentOrderListFilter,
  PaymentOrderRepository,
} from '../../application/ports/index.js';
import type { Database } from './db.js';
import { paymentOrderEvents, paymentOrders } from './schema/payment-orders.js';
import {
  paymentOrderEventToRow,
  paymentOrderFromRow,
  paymentOrderToRow,
} from './mappers/payment-order.mapper.js';

/** Statuses that keep a tenant's wallet locked against change (RN-09). */
const OPEN_STATUSES: OrderStatus[] = ['CREATED', 'ACTIVE'];

/**
 * Drizzle-backed `PaymentOrderRepository` (TASK-013). `save` upserts the order and appends
 * any pulled domain events atomically. Immutable columns (RN-03/RN-04) are written only on
 * insert; the conflict update touches lifecycle/registration fields exclusively.
 */
export class DrizzlePaymentOrderRepository implements PaymentOrderRepository {
  constructor(private readonly db: Database) {}

  async save(order: PaymentOrder): Promise<void> {
    const row = paymentOrderToRow(order);
    const events = order.pullEvents();

    await this.db.transaction(async (tx) => {
      await tx
        .insert(paymentOrders)
        .values(row)
        .onConflictDoUpdate({
          target: paymentOrders.id,
          set: {
            status: row.status,
            sorobanContractId: row.sorobanContractId,
            blockchainTransactionHash: row.blockchainTransactionHash,
            metadata: row.metadata,
            correlationId: row.correlationId,
            updatedAt: row.updatedAt,
            paidAt: row.paidAt,
          },
        });

      if (events.length > 0) {
        await tx
          .insert(paymentOrderEvents)
          .values(
            events.map((event) => paymentOrderEventToRow(order.id, event, order.correlationId)),
          );
      }
    });
  }

  async findById(id: string): Promise<PaymentOrder | null> {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, id))
      .limit(1);
    return row ? paymentOrderFromRow(row) : null;
  }

  async findBySlug(slug: string): Promise<PaymentOrder | null> {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.publicPaymentSlug, slug))
      .limit(1);
    return row ? paymentOrderFromRow(row) : null;
  }

  async findByTenantAndExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<PaymentOrder | null> {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.tenantId, tenantId), eq(paymentOrders.externalId, externalId)))
      .limit(1);
    return row ? paymentOrderFromRow(row) : null;
  }

  async listEvents(orderId: string): Promise<PaymentOrderEventRecord[]> {
    const rows = await this.db
      .select()
      .from(paymentOrderEvents)
      .where(eq(paymentOrderEvents.paymentOrderId, orderId))
      .orderBy(asc(paymentOrderEvents.createdAt));
    return rows.map((row) => ({
      id: row.id,
      paymentOrderId: row.paymentOrderId,
      eventType: row.eventType,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    }));
  }

  async countOpenByTenant(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(paymentOrders)
      .where(
        and(eq(paymentOrders.tenantId, tenantId), inArray(paymentOrders.status, OPEN_STATUSES)),
      );
    return row?.value ?? 0;
  }

  async list(filter: PaymentOrderListFilter): Promise<Page<PaymentOrder>> {
    const conditions = [];
    if (filter.tenantId) {
      conditions.push(eq(paymentOrders.tenantId, filter.tenantId));
    }
    if (filter.status) {
      conditions.push(eq(paymentOrders.status, filter.status));
    }
    if (filter.externalId) {
      conditions.push(eq(paymentOrders.externalId, filter.externalId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(paymentOrders)
        .where(where)
        .orderBy(sql`${paymentOrders.createdAt} desc`)
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(paymentOrders).where(where),
    ]);

    return { items: rows.map(paymentOrderFromRow), total: totals?.value ?? 0 };
  }
}
