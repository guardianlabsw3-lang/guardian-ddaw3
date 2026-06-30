import type { Tenant } from '../../domain/tenant/index.js';

/** Read model for a tenant returned by use cases (camelCase domain shape, no secrets). */
export interface TenantView {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  document: { type: string; number: string };
  adminEmail: string;
  wallet: { publicKey: string; network: string } | null;
  defaultAsset: { code: string; issuer: string | null };
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantWalletView {
  publicKey: string;
  network: string;
}

export function toTenantView(tenant: Tenant): TenantView {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    legalName: tenant.legalName,
    document: { type: tenant.document.type, number: tenant.document.number },
    adminEmail: tenant.adminEmail,
    wallet: tenant.wallet
      ? { publicKey: tenant.wallet.publicKey, network: tenant.wallet.network }
      : null,
    defaultAsset: { code: tenant.defaultAsset.code, issuer: tenant.defaultAsset.issuer },
    status: tenant.status,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export function toTenantWalletView(tenant: Tenant): TenantWalletView | null {
  return tenant.wallet
    ? { publicKey: tenant.wallet.publicKey, network: tenant.wallet.network }
    : null;
}
