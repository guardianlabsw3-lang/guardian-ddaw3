import type { Clock, StellarAccountVerifier, TenantRepository } from '../ports/index.js';
import { conflict, notFound, unprocessable } from '../shared/errors.js';
import { toTenantView, type TenantView } from './views.js';

/**
 * Activate a tenant (spec 05 §6 / UC-01). Activation requires a wallet that is both set and
 * present on-chain: without a wallet the tenant could never issue orders (RN-01), so we reject
 * with `TENANT_WALLET_NOT_SET`; and a wallet that no longer exists on Stellar is rejected with
 * `STELLAR_ACCOUNT_NOT_FOUND` so an active tenant always resolves to a real receiver.
 */
export class ActivateTenant {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
    private readonly stellar: StellarAccountVerifier,
  ) {}

  async execute(id: string): Promise<TenantView> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id });
    }
    if (tenant.wallet === null) {
      throw conflict('TENANT_WALLET_NOT_SET', 'Cannot activate a tenant without a wallet', { id });
    }
    if (!(await this.stellar.exists(tenant.wallet))) {
      throw unprocessable(
        'STELLAR_ACCOUNT_NOT_FOUND',
        'The tenant wallet does not exist on the Stellar network',
        { id, publicKey: tenant.wallet.publicKey },
      );
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
