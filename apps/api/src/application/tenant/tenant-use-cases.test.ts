import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActivateTenant,
  AssignTenantWallet,
  CreateTenant,
  DeactivateTenant,
  GetTenant,
  GetTenantWallet,
  ListTenants,
  OnboardTenantWallet,
} from './index.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  StubIdGenerator,
  StubSlugGenerator,
  StubStellarAccountVerifier,
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
  let stellar: StubStellarAccountVerifier;
  let create: CreateTenant;

  beforeEach(() => {
    tenants = new InMemoryTenantRepository();
    orders = new InMemoryPaymentOrderRepository();
    clock = new FixedClock(FIXED_NOW);
    stellar = new StubStellarAccountVerifier();
    create = new CreateTenant(
      tenants,
      new StubIdGenerator('tenant'),
      new StubSlugGenerator(),
      clock,
      stellar,
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

    it('rejects a wallet that does not exist on Stellar (STELLAR_ACCOUNT_NOT_FOUND, 422)', async () => {
      stellar.deny(VALID_KEYS[0]!);
      await expectAppError(
        create.execute(validInput({ wallet: wallet() })),
        'STELLAR_ACCOUNT_NOT_FOUND',
        422,
      );
    });

    it('rejects a duplicate document with TENANT_DOCUMENT_CONFLICT (409)', async () => {
      await create.execute(validInput());
      await expectAppError(create.execute(validInput()), 'TENANT_DOCUMENT_CONFLICT', 409);
    });

    it('rejects a wallet already used by another tenant (TENANT_WALLET_CONFLICT, 409)', async () => {
      await create.execute(validInput({ wallet: wallet() }));
      await expectAppError(
        create.execute(
          validInput({ document: { type: 'CNPJ', number: '11444777000161' }, wallet: wallet() }),
        ),
        'TENANT_WALLET_CONFLICT',
        409,
      );
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
      const activate = new ActivateTenant(tenants, clock, stellar);

      await expectAppError(activate.execute(created.id), 'TENANT_WALLET_NOT_SET', 409);

      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      await assign.execute(created.id, wallet());
      const activated = await activate.execute(created.id);
      expect(activated.status).toBe('ACTIVE');
    });

    it('refuses to activate when the wallet no longer exists on Stellar', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      stellar.deny(VALID_KEYS[0]!);
      await expectAppError(
        new ActivateTenant(tenants, clock, stellar).execute(created.id),
        'STELLAR_ACCOUNT_NOT_FOUND',
        422,
      );
    });

    it('deactivates an active tenant', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock, stellar).execute(created.id);
      const view = await new DeactivateTenant(tenants, clock).execute(created.id);
      expect(view.status).toBe('INACTIVE');
    });

    it('returns TENANT_NOT_FOUND (404) for an unknown id', async () => {
      await expectAppError(
        new ActivateTenant(tenants, clock, stellar).execute('missing'),
        'TENANT_NOT_FOUND',
        404,
      );
    });
  });

  describe('AssignTenantWallet', () => {
    it('assigns a valid Testnet wallet', async () => {
      const created = await create.execute(validInput());
      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      const view = await assign.execute(created.id, wallet());
      expect(view.publicKey).toBe(VALID_KEYS[0]);
      expect(view.network).toBe('TESTNET');
    });

    it('rejects an invalid key / non-Testnet network', async () => {
      const created = await create.execute(validInput());
      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
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

    it('rejects a wallet that does not exist on Stellar (STELLAR_ACCOUNT_NOT_FOUND, 422)', async () => {
      const created = await create.execute(validInput());
      stellar.deny(VALID_KEYS[0]!);
      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      await expectAppError(assign.execute(created.id, wallet()), 'STELLAR_ACCOUNT_NOT_FOUND', 422);
    });

    it('rejects a wallet already assigned to another tenant (TENANT_WALLET_CONFLICT, 409)', async () => {
      await create.execute(validInput({ wallet: wallet(VALID_KEYS[0]) }));
      const other = await create.execute(
        validInput({ document: { type: 'CNPJ', number: '11444777000161' } }),
      );
      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      await expectAppError(
        assign.execute(other.id, wallet(VALID_KEYS[0])),
        'TENANT_WALLET_CONFLICT',
        409,
      );
    });

    it('blocks a wallet change while open orders exist (RN-09)', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock, stellar).execute(created.id);
      // an open (CREATED) order for this tenant
      await orders.save(buildOrder({ tenantId: created.id }));

      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      await expectAppError(
        assign.execute(created.id, wallet(VALID_KEYS[1])),
        'WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS',
        409,
      );
    });

    it('allows re-assigning the same wallet even with open orders (no-op change)', async () => {
      const created = await create.execute(validInput({ wallet: wallet() }));
      await new ActivateTenant(tenants, clock, stellar).execute(created.id);
      await orders.save(buildOrder({ tenantId: created.id }));
      const assign = new AssignTenantWallet(tenants, orders, clock, stellar);
      const view = await assign.execute(created.id, wallet(VALID_KEYS[0]));
      expect(view.publicKey).toBe(VALID_KEYS[0]);
    });
  });

  describe('OnboardTenantWallet', () => {
    const onboard = () =>
      new OnboardTenantWallet(
        tenants,
        create,
        new AssignTenantWallet(tenants, orders, clock, stellar),
      );

    it('auto-creates a tenant seeded from the admin email on first connect', async () => {
      const view = await onboard().execute('owner@acme.test', wallet());

      expect(view.adminEmail).toBe('owner@acme.test');
      expect(view.name).toBe('owner');
      expect(view.document).toEqual({ type: 'OTHER', number: 'owner@acme.test' });
      expect(view.wallet?.publicKey).toBe(VALID_KEYS[0]);
      expect(view.status).toBe('INACTIVE');
      expect(await tenants.findByAdminEmail('owner@acme.test')).not.toBeNull();
    });

    it('re-assigns the wallet to the existing tenant on a later connect (no duplicate)', async () => {
      const first = await onboard().execute('owner@acme.test', wallet(VALID_KEYS[0]));
      const second = await onboard().execute('owner@acme.test', wallet(VALID_KEYS[1]));

      expect(second.id).toBe(first.id);
      expect(second.wallet?.publicKey).toBe(VALID_KEYS[1]);
      expect((await new ListTenants(tenants).execute({})).total).toBe(1);
    });

    it('rejects an invalid wallet with the shared validation code', async () => {
      await expectAppError(
        onboard().execute('owner@acme.test', wallet('NOT-A-KEY')),
        'INVALID_STELLAR_PUBLIC_KEY',
        422,
      );
    });

    it('rejects an invalid admin email', async () => {
      await expectAppError(onboard().execute('nope', wallet()), 'INVALID_EMAIL', 422);
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
