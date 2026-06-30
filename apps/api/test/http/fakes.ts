import type { Tenant } from '../../src/domain/tenant/index.js';
import type { OrderStatus, PaymentOrder } from '../../src/domain/payment-order/index.js';
import type {
  AdminUserRecord,
  AdminUserRepository,
  ApiKeyRecord,
  ApiKeyRepository,
  CreateWebhookDeliveryInput,
  IdempotencyRecord,
  IdempotencyStore,
  Page,
  PaymentOrderEventRecord,
  PaymentOrderListFilter,
  PaymentOrderRepository,
  TenantListFilter,
  TenantRepository,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookDeliveryStatus,
  WebhookSender,
  WebhookSendResult,
} from '../../src/application/ports/index.js';

let seq = 0;
const id = (): string => `id_${(seq += 1)}`;

/** In-memory `TenantRepository` storing live aggregates (mutations persist by reference). */
export class InMemoryTenantRepository implements TenantRepository {
  readonly byId = new Map<string, Tenant>();

  async save(tenant: Tenant): Promise<void> {
    this.byId.set(tenant.id, tenant);
  }
  async findById(idValue: string): Promise<Tenant | null> {
    return this.byId.get(idValue) ?? null;
  }
  async findBySlug(slug: string): Promise<Tenant | null> {
    return [...this.byId.values()].find((t) => t.slug === slug) ?? null;
  }
  async findByDocument(documentNumber: string): Promise<Tenant | null> {
    return [...this.byId.values()].find((t) => t.document.number === documentNumber) ?? null;
  }
  async existsByDocument(documentNumber: string): Promise<boolean> {
    return (await this.findByDocument(documentNumber)) !== null;
  }
  async existsBySlug(slug: string): Promise<boolean> {
    return (await this.findBySlug(slug)) !== null;
  }
  async list(filter: TenantListFilter): Promise<Page<Tenant>> {
    let items = [...this.byId.values()];
    if (filter.status) {
      items = items.filter((t) => t.status === filter.status);
    }
    if (filter.document) {
      items = items.filter((t) => t.document.number.includes(filter.document!));
    }
    const total = items.length;
    const offset = filter.offset ?? 0;
    return { items: items.slice(offset, offset + (filter.limit ?? 50)), total };
  }
}

/** In-memory `PaymentOrderRepository` with an event trail captured on `save`. */
export class InMemoryPaymentOrderRepository implements PaymentOrderRepository {
  readonly byId = new Map<string, PaymentOrder>();
  private readonly events = new Map<string, PaymentOrderEventRecord[]>();

  async save(order: PaymentOrder): Promise<void> {
    this.byId.set(order.id, order);
    const pulled = order.pullEvents();
    const list = this.events.get(order.id) ?? [];
    for (const event of pulled) {
      list.push({
        id: id(),
        paymentOrderId: order.id,
        eventType: event.type,
        payload: event.payload,
        correlationId: order.correlationId,
        createdAt: event.occurredAt,
      });
    }
    this.events.set(order.id, list);
  }
  async findById(idValue: string): Promise<PaymentOrder | null> {
    return this.byId.get(idValue) ?? null;
  }
  async findBySlug(slug: string): Promise<PaymentOrder | null> {
    return [...this.byId.values()].find((o) => o.publicSlug === slug) ?? null;
  }
  async findByTenantAndExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<PaymentOrder | null> {
    return (
      [...this.byId.values()].find((o) => o.tenantId === tenantId && o.externalId === externalId) ??
      null
    );
  }
  async listEvents(orderId: string): Promise<PaymentOrderEventRecord[]> {
    return this.events.get(orderId) ?? [];
  }
  async countOpenByTenant(tenantId: string): Promise<number> {
    const open: OrderStatus[] = ['CREATED', 'ACTIVE'];
    return [...this.byId.values()].filter((o) => o.tenantId === tenantId && open.includes(o.status))
      .length;
  }
  async list(filter: PaymentOrderListFilter): Promise<Page<PaymentOrder>> {
    let items = [...this.byId.values()];
    if (filter.tenantId) {
      items = items.filter((o) => o.tenantId === filter.tenantId);
    }
    if (filter.status) {
      items = items.filter((o) => o.status === filter.status);
    }
    if (filter.externalId) {
      items = items.filter((o) => o.externalId === filter.externalId);
    }
    const total = items.length;
    const offset = filter.offset ?? 0;
    return { items: items.slice(offset, offset + (filter.limit ?? 50)), total };
  }
}

export class InMemoryAdminUserRepository implements AdminUserRepository {
  readonly byEmail = new Map<string, AdminUserRecord>();
  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }
  async create(input: {
    email: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminUserRecord> {
    const record: AdminUserRecord = {
      id: id(),
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role ?? 'admin',
      isActive: true,
    };
    this.byEmail.set(record.email, record);
    return record;
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  readonly byPrefix = new Map<string, ApiKeyRecord>();
  async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
    return this.byPrefix.get(prefix) ?? null;
  }
  async create(record: {
    name: string;
    keyPrefix: string;
    keyHash: string;
    webhookSecretHash?: string | null;
    scopes: string[];
    allowedTenantIds?: string[] | null;
  }): Promise<ApiKeyRecord> {
    const stored: ApiKeyRecord = {
      id: id(),
      name: record.name,
      keyPrefix: record.keyPrefix,
      keyHash: record.keyHash,
      webhookSecretHash: record.webhookSecretHash ?? null,
      scopes: record.scopes,
      allowedTenantIds: record.allowedTenantIds ?? null,
      isActive: true,
    };
    this.byPrefix.set(stored.keyPrefix, stored);
    return stored;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();
  private key(key: string, endpoint: string): string {
    return `${endpoint}::${key}`;
  }
  async find(key: string, endpoint: string): Promise<IdempotencyRecord | null> {
    return this.store.get(this.key(key, endpoint)) ?? null;
  }
  async save(
    key: string,
    endpoint: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    const k = this.key(key, endpoint);
    if (!this.store.has(k)) {
      this.store.set(k, { requestHash, responseStatus, responseBody });
    }
  }
}

export class InMemoryWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly byId = new Map<string, WebhookDeliveryRecord>();
  async create(input: CreateWebhookDeliveryInput): Promise<WebhookDeliveryRecord> {
    const record: WebhookDeliveryRecord = {
      id: id(),
      paymentOrderId: input.paymentOrderId,
      eventType: input.eventType,
      targetUrl: input.targetUrl,
      attempt: input.attempt,
      status: input.status,
      requestSignature: input.requestSignature ?? null,
      responseStatus: input.responseStatus ?? null,
      nextRetryAt: input.nextRetryAt ?? null,
      createdAt: new Date('2026-06-30T12:00:00Z'),
      updatedAt: new Date('2026-06-30T12:00:00Z'),
    };
    this.byId.set(record.id, record);
    return record;
  }
  async findDue(now: Date): Promise<WebhookDeliveryRecord[]> {
    return [...this.byId.values()].filter(
      (d) =>
        (d.status === 'failed' || d.status === 'pending') &&
        d.nextRetryAt !== null &&
        d.nextRetryAt <= now,
    );
  }
  async update(
    idValue: string,
    patch: {
      attempt: number;
      status: WebhookDeliveryStatus;
      responseStatus?: number | null;
      requestSignature?: string | null;
      nextRetryAt?: Date | null;
    },
  ): Promise<void> {
    const existing = this.byId.get(idValue);
    if (existing) {
      this.byId.set(idValue, {
        ...existing,
        attempt: patch.attempt,
        status: patch.status,
        responseStatus: patch.responseStatus ?? null,
        requestSignature: patch.requestSignature ?? null,
        nextRetryAt: patch.nextRetryAt ?? null,
      });
    }
  }
  async listByOrder(paymentOrderId: string): Promise<WebhookDeliveryRecord[]> {
    return [...this.byId.values()].filter((d) => d.paymentOrderId === paymentOrderId);
  }
}

/** Webhook sender that records calls and returns a scripted result. */
export class FakeWebhookSender implements WebhookSender {
  readonly calls: { target: string; body: string; signature: string }[] = [];
  constructor(private result: WebhookSendResult = { ok: true, status: 200 }) {}
  setResult(result: WebhookSendResult): void {
    this.result = result;
  }
  async send(target: string, body: string, signature: string): Promise<WebhookSendResult> {
    this.calls.push({ target, body, signature });
    return this.result;
  }
}
