import type { Tenant } from '../src/domain/tenant/index.js';
import type { OrderStatus, PaymentOrder } from '../src/domain/payment-order/index.js';
import type {
  Clock,
  IdGenerator,
  Page,
  PaymentOrderEventRecord,
  PaymentOrderListFilter,
  PaymentOrderRepository,
  SlugGenerator,
  TenantListFilter,
  TenantRepository,
} from '../src/application/ports/index.js';

/** Deterministic clock for use-case tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
}

/** Sequential, predictable id generator. */
export class StubIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  uuid(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}

/** Deterministic slug generator. */
export class StubSlugGenerator implements SlugGenerator {
  private n = 0;
  tenantSlug(seed: string): string {
    const base = seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base.length > 0 ? base : 'tenant';
  }
  publicPaymentSlug(): string {
    this.n += 1;
    return `p_${this.n.toString().padStart(22, '0')}`;
  }
}

const OPEN: OrderStatus[] = ['CREATED', 'ACTIVE'];

export class InMemoryTenantRepository implements TenantRepository {
  readonly store = new Map<string, Tenant>();

  async save(tenant: Tenant): Promise<void> {
    this.store.set(tenant.id, tenant);
  }
  async findById(id: string): Promise<Tenant | null> {
    return this.store.get(id) ?? null;
  }
  async findBySlug(slug: string): Promise<Tenant | null> {
    return [...this.store.values()].find((t) => t.slug === slug) ?? null;
  }
  async findByDocument(documentNumber: string): Promise<Tenant | null> {
    return [...this.store.values()].find((t) => t.document.number === documentNumber) ?? null;
  }
  async existsByDocument(documentNumber: string): Promise<boolean> {
    return (await this.findByDocument(documentNumber)) !== null;
  }
  async existsBySlug(slug: string): Promise<boolean> {
    return (await this.findBySlug(slug)) !== null;
  }
  async list(filter: TenantListFilter): Promise<Page<Tenant>> {
    let items = [...this.store.values()];
    if (filter.status) items = items.filter((t) => t.status === filter.status);
    if (filter.document) items = items.filter((t) => t.document.number === filter.document);
    return { items, total: items.length };
  }
}

export class InMemoryPaymentOrderRepository implements PaymentOrderRepository {
  readonly store = new Map<string, PaymentOrder>();
  readonly events: PaymentOrderEventRecord[] = [];
  private eventSeq = 0;

  async save(order: PaymentOrder): Promise<void> {
    const isInsert = !this.store.has(order.id);
    if (isInsert && order.externalId !== null) {
      const clash = [...this.store.values()].some(
        (o) => o.tenantId === order.tenantId && o.externalId === order.externalId,
      );
      if (clash) {
        throw new Error('duplicate key (tenant_id, external_id)');
      }
    }
    for (const event of order.pullEvents()) {
      this.eventSeq += 1;
      this.events.push({
        id: `evt-${this.eventSeq}`,
        paymentOrderId: order.id,
        eventType: event.type,
        payload: event.payload,
        correlationId: order.correlationId,
        createdAt: event.occurredAt,
      });
    }
    this.store.set(order.id, order);
  }
  async findById(id: string): Promise<PaymentOrder | null> {
    return this.store.get(id) ?? null;
  }
  async findBySlug(slug: string): Promise<PaymentOrder | null> {
    return [...this.store.values()].find((o) => o.publicSlug === slug) ?? null;
  }
  async findByTenantAndExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<PaymentOrder | null> {
    return (
      [...this.store.values()].find(
        (o) => o.tenantId === tenantId && o.externalId === externalId,
      ) ?? null
    );
  }
  async listEvents(orderId: string): Promise<PaymentOrderEventRecord[]> {
    return this.events.filter((e) => e.paymentOrderId === orderId);
  }
  async countOpenByTenant(tenantId: string): Promise<number> {
    return [...this.store.values()].filter(
      (o) => o.tenantId === tenantId && OPEN.includes(o.status),
    ).length;
  }
  async list(filter: PaymentOrderListFilter): Promise<Page<PaymentOrder>> {
    let items = [...this.store.values()];
    if (filter.tenantId) items = items.filter((o) => o.tenantId === filter.tenantId);
    if (filter.status) items = items.filter((o) => o.status === filter.status);
    if (filter.externalId) items = items.filter((o) => o.externalId === filter.externalId);
    return { items, total: items.length };
  }
}
