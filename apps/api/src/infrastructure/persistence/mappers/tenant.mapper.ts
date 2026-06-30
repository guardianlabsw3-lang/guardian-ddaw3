import {
  AssetSchema,
  DocumentSchema,
  EmailSchema,
  SlugSchema,
  StellarAccountSchema,
  TenantStatusSchema,
} from '@payorder/shared';
import { Tenant } from '../../../domain/tenant/index.js';
import type { NewTenantRow, TenantRow } from '../schema/tenants.js';

/**
 * Maps the `Tenant` aggregate to/from its `tenants` row (spec 09 §1). On read, value
 * objects are re-validated through the shared schemas so malformed persisted data fails
 * loudly rather than silently flowing into the domain.
 */
export function tenantToRow(tenant: Tenant): NewTenantRow {
  const wallet = tenant.wallet;
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    legalName: tenant.legalName,
    documentType: tenant.document.type,
    documentNumber: tenant.document.number,
    adminEmail: tenant.adminEmail,
    stellarWalletPublicKey: wallet ? wallet.publicKey : null,
    stellarNetwork: wallet ? wallet.network : 'TESTNET',
    defaultAssetCode: tenant.defaultAsset.code,
    defaultAssetIssuer: tenant.defaultAsset.issuer,
    status: tenant.status,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export function tenantFromRow(row: TenantRow): Tenant {
  const wallet =
    row.stellarWalletPublicKey === null
      ? null
      : StellarAccountSchema.parse({
          publicKey: row.stellarWalletPublicKey,
          network: row.stellarNetwork,
        });

  return Tenant.fromPersistence({
    id: row.id,
    slug: SlugSchema.parse(row.slug),
    name: row.name,
    legalName: row.legalName,
    document: DocumentSchema.parse({ type: row.documentType, number: row.documentNumber }),
    adminEmail: EmailSchema.parse(row.adminEmail),
    wallet,
    defaultAsset: AssetSchema.parse({ code: row.defaultAssetCode, issuer: row.defaultAssetIssuer }),
    status: TenantStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
