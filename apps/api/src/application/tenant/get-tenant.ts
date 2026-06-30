import type { Page, TenantListFilter, TenantRepository } from '../ports/index.js';
import { notFound } from '../shared/errors.js';
import { toTenantView, type TenantView } from './views.js';

/** Load a tenant by id (`TENANT_NOT_FOUND` when absent). */
export class GetTenant {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(id: string): Promise<TenantView> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id });
    }
    return toTenantView(tenant);
  }
}

/** List tenants with optional status/document filters and pagination (spec 08 §2). */
export class ListTenants {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(filter: TenantListFilter = {}): Promise<Page<TenantView>> {
    const page = await this.tenants.list(filter);
    return { items: page.items.map(toTenantView), total: page.total };
  }
}
