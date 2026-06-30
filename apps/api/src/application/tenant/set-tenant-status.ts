import type { Clock, TenantRepository } from '../ports/index.js';
import { conflict, notFound } from '../shared/errors.js';
import { toTenantView, type TenantView } from './views.js';

/**
 * Activate a tenant (spec 05 §6 / UC-01). Activation requires a wallet — without one the
 * tenant could never issue orders (RN-01), so we reject early with `TENANT_WALLET_NOT_SET`.
 */
export class ActivateTenant {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
  ) {}

  async execute(id: string): Promise<TenantView> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id });
    }
    if (tenant.wallet === null) {
      throw conflict('TENANT_WALLET_NOT_SET', 'Cannot activate a tenant without a wallet', { id });
    }
    tenant.activate(this.clock.now());
    await this.tenants.save(tenant);
    return toTenantView(tenant);
  }
}

/** Deactivate a tenant (UC-01). Idempotent at the domain level. */
export class DeactivateTenant {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
  ) {}

  async execute(id: string): Promise<TenantView> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id });
    }
    tenant.deactivate(this.clock.now());
    await this.tenants.save(tenant);
    return toTenantView(tenant);
  }
}
