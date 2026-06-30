import { AssetSchema, SlugSchema, type Asset } from '@payorder/shared';
import { PaymentOrder, normalizeOrderSource } from '../../domain/payment-order/index.js';
import type { Tenant } from '../../domain/tenant/index.js';
import type {
  Clock,
  IdGenerator,
  OrderRegistrationQueue,
  PaymentOrderRepository,
  SlugGenerator,
  TenantRepository,
} from '../ports/index.js';
import { conflict, notFound, unprocessable, validate } from '../shared/errors.js';
import {
  CreatePaymentOrderInputSchema,
  FORBIDDEN_WALLET_FIELDS,
  type CreatePaymentOrderInput,
} from './input.js';
import { toPaymentOrderView, type PaymentOrderView } from './views.js';

export interface CreatePaymentOrderOptions {
  correlationId?: string | null;
}

export interface CreatePaymentOrderDeps {
  tenants: TenantRepository;
  orders: PaymentOrderRepository;
  ids: IdGenerator;
  slugs: SlugGenerator;
  clock: Clock;
  registrationQueue: OrderRegistrationQueue;
  /** Base URL of the public payment web app, used to build `publicPaymentUrl`. */
  publicWebUrl: string;
}

/**
 * UC-03/04/05 — the product core (TASK-015, spec 08 §3.1). One flow for every origin:
 * resolve the tenant (id/slug/document), enforce RN-01 (active + wallet), copy the wallet
 * (RN-02/RN-03), default the asset to the tenant's, compute the canonical hash (RN-04 via
 * the domain factory), persist `CREATED` with an opaque public slug, and enqueue async
 * on-chain registration (ADR-06). Idempotent by `(tenant_id, external_id)` (RF-16): a
 * repeat returns the existing order instead of creating a duplicate.
 */
export class CreatePaymentOrder {
  constructor(private readonly deps: CreatePaymentOrderDeps) {}

  async execute(
    rawInput: unknown,
    options: CreatePaymentOrderOptions = {},
  ): Promise<PaymentOrderView> {
    this.rejectWalletFields(rawInput);
    const input = validate(CreatePaymentOrderInputSchema, rawInput);

    const tenant = await this.resolveTenant(input);
    if (tenant.status !== 'ACTIVE') {
      throw conflict('TENANT_INACTIVE', 'Tenant is not active', { tenantId: tenant.id });
    }
    const wallet = tenant.wallet;
    if (wallet === null) {
      throw conflict('TENANT_WALLET_NOT_SET', 'Tenant has no Stellar wallet configured', {
        tenantId: tenant.id,
      });
    }

    // Idempotency by origin (RF-16): return the existing order untouched.
    if (input.externalId) {
      const existing = await this.deps.orders.findByTenantAndExternalId(
        tenant.id,
        input.externalId,
      );
      if (existing) {
        return toPaymentOrderView(existing, this.deps.publicWebUrl);
      }
    }

    const asset = this.resolveAsset(input, tenant);
    const slug = SlugSchema.parse(this.deps.slugs.publicPaymentSlug());
    const correlationId = options.correlationId ?? null;

    const order = PaymentOrder.create({
      id: this.deps.ids.uuid(),
      tenantId: tenant.id,
      amount: String(input.amount),
      asset,
      receiverWallet: wallet.publicKey,
      publicSlug: slug,
      externalId: input.externalId ?? null,
      dueDate: input.dueDate ?? null,
      description: input.description ?? null,
      source: normalizeOrderSource(input.source),
      metadata: this.buildMetadata(input),
      correlationId,
      now: this.deps.clock.now(),
    });

    await this.deps.orders.save(order);
    await this.deps.registrationQueue.enqueueRegister({ paymentOrderId: order.id, correlationId });

    return toPaymentOrderView(order, this.deps.publicWebUrl);
  }

  /** RN-02: reject any wallet field on the order payload (`WALLET_NOT_ALLOWED_ON_ORDER`). */
  private rejectWalletFields(rawInput: unknown): void {
    if (rawInput === null || typeof rawInput !== 'object') {
      return;
    }
    const record = rawInput as Record<string, unknown>;
    for (const field of FORBIDDEN_WALLET_FIELDS) {
      if (record[field] !== undefined) {
        throw unprocessable(
          'WALLET_NOT_ALLOWED_ON_ORDER',
          'The receiver wallet must not be supplied on the order; it is derived from the tenant',
          { field },
        );
      }
    }
  }

  /** Resolve the tenant by id, then slug, then document (RF-05). */
  private async resolveTenant(input: CreatePaymentOrderInput): Promise<Tenant> {
    let tenant: Tenant | null = null;
    if (input.tenantId) {
      tenant = await this.deps.tenants.findById(input.tenantId);
    } else if (input.slug) {
      tenant = await this.deps.tenants.findBySlug(input.slug);
    } else if (input.tenantDocument) {
      tenant = await this.deps.tenants.findByDocument(input.tenantDocument);
    }
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', {
        tenantId: input.tenantId,
        slug: input.slug,
        tenantDocument: input.tenantDocument,
      });
    }
    return tenant;
  }

  /** Use the provided asset or fall back to the tenant default (spec 08 §3.1 rule 5). */
  private resolveAsset(input: CreatePaymentOrderInput, tenant: Tenant): Asset {
    if (input.assetCode === undefined) {
      return tenant.defaultAsset;
    }
    return validate(AssetSchema, { code: input.assetCode, issuer: input.assetIssuer ?? null });
  }

  private buildMetadata(input: CreatePaymentOrderInput): Record<string, unknown> {
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.callbackUrl) {
      metadata.callback_url = input.callbackUrl;
    }
    return metadata;
  }
}
