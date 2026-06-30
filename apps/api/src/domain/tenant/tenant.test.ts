import { describe, it, expect } from 'vitest';
import { Tenant } from './tenant.js';
import { DomainError } from '../shared/errors.js';
import {
  cnpj,
  email,
  slug,
  testnetAccount,
  XLM,
  expectDomainError,
} from '../../../test/fixtures.js';

const NOW = new Date('2026-06-30T12:00:00Z');

function newTenant(withWallet = false): Tenant {
  return Tenant.create({
    id: 'tenant-1',
    slug: slug(),
    name: 'ACME',
    legalName: 'ACME LTDA',
    document: cnpj(),
    adminEmail: email(),
    defaultAsset: XLM,
    wallet: withWallet ? testnetAccount() : null,
    now: NOW,
  });
}

describe('Tenant.create', () => {
  it('creates an INACTIVE tenant with no wallet and emits TenantCreated', () => {
    const tenant = newTenant();
    expect(tenant.status).toBe('INACTIVE');
    expect(tenant.wallet).toBeNull();
    expect(tenant.canIssueOrders()).toBe(false);
    expect(tenant.createdAt).toBe(NOW);
    expect(tenant.updatedAt).toBe(NOW);

    const events = tenant.pullEvents();
    expect(events.map((e) => e.type)).toEqual(['TenantCreated']);
    expect(tenant.pullEvents()).toHaveLength(0); // drained
  });

  it('emits TenantWalletAssigned too when created with a wallet', () => {
    const tenant = newTenant(true);
    expect(tenant.pullEvents().map((e) => e.type)).toEqual([
      'TenantCreated',
      'TenantWalletAssigned',
    ]);
  });
});

describe('Tenant.activate / deactivate', () => {
  it('refuses activation without a wallet (TENANT_WALLET_NOT_SET)', () => {
    const tenant = newTenant();
    expectDomainError(() => tenant.activate(NOW), 'TENANT_WALLET_NOT_SET');
    expect(tenant.status).toBe('INACTIVE');
  });

  it('activates once a wallet is present and can then issue orders', () => {
    const tenant = newTenant();
    tenant.pullEvents();
    tenant.assignWallet(testnetAccount(), NOW);
    tenant.activate(NOW);
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.canIssueOrders()).toBe(true);
    expect(tenant.pullEvents().map((e) => e.type)).toEqual([
      'TenantWalletAssigned',
      'TenantActivated',
    ]);
  });

  it('is idempotent on repeated activate/deactivate', () => {
    const tenant = newTenant(true);
    tenant.pullEvents();
    tenant.activate(NOW);
    tenant.activate(NOW); // no second event
    expect(tenant.pullEvents().map((e) => e.type)).toEqual(['TenantActivated']);

    tenant.deactivate(NOW);
    tenant.deactivate(NOW);
    expect(tenant.status).toBe('INACTIVE');
    expect(tenant.pullEvents().map((e) => e.type)).toEqual(['TenantDeactivated']);
  });
});

describe('Tenant.assignWallet', () => {
  it('replaces the wallet and bumps updatedAt', () => {
    const tenant = newTenant();
    const later = new Date('2026-07-01T00:00:00Z');
    tenant.assignWallet(testnetAccount(), later);
    expect(tenant.wallet).not.toBeNull();
    expect(tenant.updatedAt).toBe(later);
  });
});

describe('Tenant.fromPersistence', () => {
  it('rebuilds without emitting events', () => {
    const tenant = Tenant.fromPersistence({
      id: 'tenant-1',
      slug: slug(),
      name: 'ACME',
      legalName: 'ACME LTDA',
      document: cnpj(),
      adminEmail: email(),
      wallet: testnetAccount(),
      defaultAsset: XLM,
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(tenant.pullEvents()).toHaveLength(0);
    expect(tenant.canIssueOrders()).toBe(true);
  });
});

describe('DomainError instanceof', () => {
  it('activate error is a DomainError with the right code', () => {
    const tenant = newTenant();
    try {
      tenant.activate(NOW);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('TENANT_WALLET_NOT_SET');
    }
  });
});
