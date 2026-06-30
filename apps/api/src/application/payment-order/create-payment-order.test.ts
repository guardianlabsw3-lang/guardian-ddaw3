import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssetSchema,
  DocumentSchema,
  EmailSchema,
  SlugSchema,
  TenantStatusSchema,
} from '@payorder/shared';
import { Tenant } from '../../domain/tenant/index.js';
import { CreatePaymentOrder, type CreatePaymentOrderDeps } from './create-payment-order.js';
import { InMemoryOrderRegistrationQueue } from '../../infrastructure/queue/in-memory-order-registration-queue.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  StubIdGenerator,
  StubSlugGenerator,
} from '../../../test/fakes.js';
import {
  FIXED_NOW,
  VALID_KEYS,
  VALID_CNPJ,
  buildTenant,
  expectAppError,
} from '../../../test/fixtures.js';

const PUBLIC_WEB_URL = 'http://localhost:3001';

interface Harness extends CreatePaymentOrderDeps {
  tenants: InMemoryTenantRepository;
  orders: InMemoryPaymentOrderRepository;
  registrationQueue: InMemoryOrderRegistrationQueue;
}

function harness(): Harness {
  return {
    tenants: new InMemoryTenantRepository(),
    orders: new InMemoryPaymentOrderRepository(),
    ids: new StubIdGenerator('order'),
    slugs: new StubSlugGenerator(),
    clock: new FixedClock(FIXED_NOW),
    registrationQueue: new InMemoryOrderRegistrationQueue(),
    publicWebUrl: PUBLIC_WEB_URL,
  };
}

const TENANT_1 = '00000000-0000-7000-8000-0000000000a1';
const TENANT_2 = '00000000-0000-7000-8000-0000000000a2';
const TENANT_3 = '00000000-0000-7000-8000-0000000000a3';

describe('CreatePaymentOrder', () => {
  let h: Harness;
  let useCase: CreatePaymentOrder;

  beforeEach(async () => {
    h = harness();
    useCase = new CreatePaymentOrder(h);
    await h.tenants.save(buildTenant({ id: TENANT_1, slug: 'acme', documentNumber: VALID_CNPJ }));
  });

  it('creates a CREATED order, copies the wallet, computes the hash and enqueues registration', async () => {
    const view = await useCase.execute({
      tenantId: TENANT_1,
      amount: '150.00',
      externalId: 'ORDER-1',
    });

    expect(view.status).toBe('CREATED');
    expect(view.amount).toBe('150.0000000');
    expect(view.receiverWalletPublicKey).toBe(VALID_KEYS[0]); // copied from tenant (RN-02/03)
    expect(view.canonicalPayloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.assetCode).toBe('XLM');
    expect(view.publicPaymentUrl).toBe(`${PUBLIC_WEB_URL}/p/${view.publicPaymentSlug}`);
    expect(view.sorobanContractId).toBeNull();

    expect(h.registrationQueue.jobs).toEqual([{ paymentOrderId: view.id, correlationId: null }]);
    const events = await h.orders.listEvents(view.id);
    expect(events.map((e) => e.eventType)).toEqual(['created']);
  });

  it('resolves the tenant by slug and by document', async () => {
    const bySlug = await useCase.execute({ slug: 'acme', amount: '10' });
    expect(bySlug.tenantId).toBe(TENANT_1);
    const byDoc = await useCase.execute({ tenantDocument: VALID_CNPJ, amount: '10' });
    expect(byDoc.tenantId).toBe(TENANT_1);
  });

  it('propagates the correlation id', async () => {
    const view = await useCase.execute(
      { tenantId: TENANT_1, amount: '10' },
      { correlationId: 'req-1' },
    );
    expect(h.registrationQueue.jobs[0]!.correlationId).toBe('req-1');
    expect(view.id).toBeDefined();
  });

  it('rejects a manually supplied wallet (WALLET_NOT_ALLOWED_ON_ORDER)', async () => {
    for (const field of ['stellar_wallet_public_key', 'receiverWalletPublicKey', 'wallet']) {
      await expectAppError(
        useCase.execute({ tenantId: TENANT_1, amount: '10', [field]: VALID_KEYS[1] }),
        'WALLET_NOT_ALLOWED_ON_ORDER',
        422,
      );
    }
    expect(h.orders.store.size).toBe(0);
  });

  it('requires a tenant reference', async () => {
    await expectAppError(useCase.execute({ amount: '10' }), 'TENANT_REFERENCE_REQUIRED', 422);
  });

  it('fails for an unknown tenant (TENANT_NOT_FOUND)', async () => {
    await expectAppError(
      useCase.execute({ tenantId: '00000000-0000-7000-8000-0000000000ff', amount: '10' }),
      'TENANT_NOT_FOUND',
      404,
    );
    await expectAppError(
      useCase.execute({ tenantDocument: '11444777000161', amount: '10' }),
      'TENANT_NOT_FOUND',
      404,
    );
  });

  it('blocks an inactive tenant (TENANT_INACTIVE)', async () => {
    await h.tenants.save(
      buildTenant({
        id: TENANT_2,
        slug: 'inactive',
        withWallet: false,
        documentNumber: '11444777000161',
      }),
    );
    await expectAppError(
      useCase.execute({ tenantId: TENANT_2, amount: '10' }),
      'TENANT_INACTIVE',
      409,
    );
  });

  it('blocks an active tenant without a wallet (TENANT_WALLET_NOT_SET)', async () => {
    // Craft the otherwise-impossible state: ACTIVE but no wallet.
    const tenant = Tenant.fromPersistence({
      id: TENANT_3,
      slug: SlugSchema.parse('nowallet'),
      name: 'NoWallet',
      legalName: 'NoWallet LTDA',
      document: DocumentSchema.parse({ type: 'CNPJ', number: '11444777000161' }),
      adminEmail: EmailSchema.parse('a@b.test'),
      wallet: null,
      defaultAsset: AssetSchema.parse({ code: 'XLM', issuer: null }),
      status: TenantStatusSchema.parse('ACTIVE'),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await h.tenants.save(tenant);
    await expectAppError(
      useCase.execute({ tenantId: TENANT_3, amount: '10' }),
      'TENANT_WALLET_NOT_SET',
      409,
    );
  });

  it('defaults the asset to the tenant default and validates an explicit asset', async () => {
    const def = await useCase.execute({ tenantId: TENANT_1, amount: '10' });
    expect(def.assetCode).toBe('XLM');
    expect(def.assetIssuer).toBeNull();

    const explicit = await useCase.execute({
      tenantId: TENANT_1,
      amount: '10',
      assetCode: 'USDC',
      assetIssuer: VALID_KEYS[2],
    });
    expect(explicit.assetCode).toBe('USDC');
    expect(explicit.assetIssuer).toBe(VALID_KEYS[2]);

    await expectAppError(
      useCase.execute({ tenantId: TENANT_1, amount: '10', assetCode: 'USDC' }),
      'ASSET_ISSUER_REQUIRED',
      422,
    );
  });

  it('is idempotent by (tenant_id, external_id)', async () => {
    const first = await useCase.execute({ tenantId: TENANT_1, amount: '150', externalId: 'DUP' });
    const second = await useCase.execute({ tenantId: TENANT_1, amount: '999', externalId: 'DUP' });
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe('150.0000000'); // original wins; no duplicate
    expect(h.orders.store.size).toBe(1);
    expect(h.registrationQueue.jobs).toHaveLength(1); // not re-enqueued
  });

  it('validates amount and due date', async () => {
    await expectAppError(
      useCase.execute({ tenantId: TENANT_1, amount: 'abc' }),
      'INVALID_AMOUNT',
      422,
    );
    await expectAppError(
      useCase.execute({ tenantId: TENANT_1, amount: '0' }),
      'AMOUNT_MUST_BE_POSITIVE',
      422,
    );
    await expectAppError(
      useCase.execute({ tenantId: TENANT_1, amount: '10', dueDate: 'soon' }),
      'INVALID_DUE_DATE',
      422,
    );
  });

  it('stores ERP callback_url in metadata and normalizes source', async () => {
    const view = await useCase.execute({
      tenantDocument: VALID_CNPJ,
      amount: '10',
      source: 'ERP',
      callbackUrl: 'https://erp.example.com/webhook',
      metadata: { invoice_number: 'NF-1001' },
    });
    expect(view.source).toBe('erp');
    expect(view.metadata).toMatchObject({
      invoice_number: 'NF-1001',
      callback_url: 'https://erp.example.com/webhook',
    });
  });
});
