import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActivateTenant,
  AssignTenantWallet,
  CreateTenant,
  DeactivateTenant,
  GetTenant,
  GetTenantWallet,
  ListTenants,
} from './index.js';
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
  expectAppError,
  buildOrder,
} from '../../../test/fixtures.js';

const validInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'ACME Pagamentos',
  legalName: 'ACME Pagamentos LTDA',
  document: { type: 'CNPJ', number: VALID_CNPJ },
  adminEmail: 'fin@acme.com.br',
  defaultAsset: { code: 'XLM', issuer: null },
  ...overrides,
});

const wallet = (publicKey = VALID_KEYS[0]) => ({ publicKey, network: 'TESTNET' });

describe('Tenant use cases', () => {
  let tenants: InMemoryTenantRepository;
  let orders: InMemoryPaymentOrderRepository;
  let clock: FixedClock;
  let create: CreateTenant;

  beforeEach(() => {
    tenants = new InMemoryTenantRepository();
    orders = new InMemoryPaymentOrderRepository();
    clock = new FixedClock(FIXED_NOW);
    create = new CreateTenant(
      tenants,
      new StubIdGenerator('tenant'),
      new StubSlugGenerator(),
      clock,
    );
  });

  describe('CreateTenant', () => {
    it('creates an INACTIVE tenant with a generated slug', async () => {
      const view = await create.execute(validInput());
      expect(view.status).toBe('INACTIVE');
      expect(view.slug).toBe('acme-pagamentos');
      expect(view.wallet).toBeNull();
      expect(await tenants.findById(view.id)).not.toBeNull();
    });

    it('can attach a wallet at creation (still INACTIVE until activation)', async () => {
      const view = await create.execute(validInput({ wallet: wallet() }));
      expect(view.wallet?.publicKey).toBe(VALID_KEYS[0]);
      expect(view.status).toBe('INACTIVE');
    });

    it('rejects a duplicate document with TENANT_DOCUMENT_CONFLICT (409)', async () => {
      await create.execute(validInput());
      await expectAppError(create.execute(validInput()), 'TENANT_DOCUMENT_CONFLICT', 409);
    });

    it('de-duplicates slugs across tenants with the same name', async () => {
      const a = await create.execute(validInput());
      const b = await create.execute(
        validInput({ document: { type: 'CNPJ', number: '11444777000161' } }),
      );
      expect(a.slug).toBe('acme-pagamentos');
      expect(b.slug).toBe('acme-pagamentos-2');
    });

    it('surfaces shared validation codes (INVALID_EMAIL, INVALID_DOCUMENT, ASSET_ISSUER_REQUIRED)', async () => {
      await expectAppError(
        create.execute(validInput({ adminEmail: 'nope' })),
        'INVALID_EMAIL',
        422,
      );
      await expectAppError(
        create.execute(validInput({ document: { type: 'CNPJ', number: '123' } })),
        'INVALID_DOCUMENT',
        422,
      );
      await expectAppError(
        create.execute(validInput({ defaultAsset: { code: 'USDC', issuer: null } })),
        'ASSET_ISSUER_REQUIRED',
        422,
      );
    });
  });

  describe('ActivateTenant / DeactivateTenant', () => {
    it('activates only when a wallet is present', async () => {
      const created = await create.execute(validInput());
      const activate = new ActivateTenant(tenants, clock);

      await expectAppError(activate.execute(created.id), 'TENANT_WALLET_NOT_SET', 409);

      const assign = new AssignTenantWallet(tenants, orders, clock);
      await assign.execute(created.id, wallet());
      const activated = await activate.execute(created.id);
      expect(activated.status).toBe('ACTIVE');
    });

    it('deactivates an active tenant', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock).execute(created.id);
      const view = await new DeactivateTenant(tenants, clock).execute(created.id);
      expect(view.status).toBe('INACTIVE');
    });

    it('returns TENANT_NOT_FOUND (404) for an unknown id', async () => {
      await expectAppError(
        new ActivateTenant(tenants, clock).execute('missing'),
        'TENANT_NOT_FOUND',
        404,
      );
    });
  });

  describe('AssignTenantWallet', () => {
    it('assigns a valid Testnet wallet', async () => {
      const created = await create.execute(validInput());
      const assign = new AssignTenantWallet(tenants, orders, clock);
      const view = await assign.execute(created.id, wallet());
      expect(view.publicKey).toBe(VALID_KEYS[0]);
      expect(view.network).toBe('TESTNET');
    });

    it('rejects an invalid key / non-Testnet network', async () => {
      const created = await create.execute(validInput());
      const assign = new AssignTenantWallet(tenants, orders, clock);
      await expectAppError(
        assign.execute(created.id, wallet('NOT-A-KEY')),
        'INVALID_STELLAR_PUBLIC_KEY',
        422,
      );
      await expectAppError(
        assign.execute(created.id, { publicKey: VALID_KEYS[0], network: 'PUBLIC' }),
        'UNSUPPORTED_NETWORK',
        422,
      );
    });

    it('blocks a wallet change while open orders exist (RN-09)', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock).execute(created.id);
      // an open (CREATED) order for this tenant
      await orders.save(buildOrder({ tenantId: created.id }));

      const assign = new AssignTenantWallet(tenants, orders, clock);
      await expectAppError(
        assign.execute(created.id, wallet(VALID_KEYS[1])),
        'WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS',
        409,
      );
    });

    it('allows re-assigning the same wallet even with open orders (no-op change)', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock).execute(created.id);
      await orders.save(buildOrder({ tenantId: created.id }));
      const assign = new AssignTenantWallet(tenants, orders, clock);
      const view = await assign.execute(created.id, wallet(VALID_KEYS[0]));
      expect(view.publicKey).toBe(VALID_KEYS[0]);
    });
  });

  describe('GetTenant / ListTenants / GetTenantWallet', () => {
    it('reads back tenants and wallet', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      expect((await new GetTenant(tenants).execute(created.id)).id).toBe(created.id);
      expect((await new GetTenantWallet(tenants).execute(created.id))?.publicKey).toBe(
        VALID_KEYS[0],
      );

      const list = await new ListTenants(tenants).execute({});
      expect(list.total).toBe(1);
      await expectAppError(new GetTenant(tenants).execute('missing'), 'TENANT_NOT_FOUND', 404);
    });
  });
});
