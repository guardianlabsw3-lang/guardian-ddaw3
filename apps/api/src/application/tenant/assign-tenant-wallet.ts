import { AssignTenantWalletInputSchema } from '@payorder/shared';
import type { Clock, PaymentOrderRepository, TenantRepository } from '../ports/index.js';
import { conflict, notFound, validate } from '../shared/errors.js';
import { toTenantWalletView, type TenantWalletView } from './views.js';

/**
 * UC-02 — register/update the tenant's destination wallet (spec 06). The wallet is
 * validated as a Testnet StrKey (shared schema → `INVALID_STELLAR_PUBLIC_KEY` /
 * `UNSUPPORTED_NETWORK`). RN-09: a change is blocked while the tenant has open
 * (`CREATED`/`ACTIVE`) orders (`WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS`). Historical orders
 * keep their copied wallet regardless (RN-03).
 */
export class AssignTenantWallet {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly orders: PaymentOrderRepository,
    private readonly clock: Clock,
  ) {}

  async execute(tenantId: string, input: unknown): Promise<TenantWalletView> {
    const wallet = validate(AssignTenantWalletInputSchema, input);

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id: tenantId });
    }

    const isChange = tenant.wallet === null || tenant.wallet.publicKey !== wallet.publicKey;
    if (isChange && (await this.orders.countOpenByTenant(tenantId)) > 0) {
      throw conflict(
        'WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS',
        'Cannot change the tenant wallet while it has active or pending orders',
        { tenantId },
      );
    }

    tenant.assignWallet(wallet, this.clock.now());
    await this.tenants.save(tenant);
    return toTenantWalletView(tenant)!;
  }
}
