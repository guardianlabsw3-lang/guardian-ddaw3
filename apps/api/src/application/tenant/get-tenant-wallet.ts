import type { TenantRepository } from '../ports/index.js';
import { notFound } from '../shared/errors.js';
import { toTenantWalletView, type TenantWalletView } from './views.js';

/** Consult a tenant's wallet (spec 06 — GET /api/tenants/{id}/wallet). */
export class GetTenantWallet {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(tenantId: string): Promise<TenantWalletView | null> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id: tenantId });
    }
    return toTenantWalletView(tenant);
  }
}
