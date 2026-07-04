import { AssignTenantWalletInputSchema } from '@payorder/shared';
import type {
  Clock,
  PaymentOrderRepository,
  StellarAccountVerifier,
  TenantRepository,
} from '../ports/index.js';
import { conflict, notFound, unprocessable, validate } from '../shared/errors.js';
import { toTenantWalletView, type TenantWalletView } from './views.js';

/**
 * UC-02 — register/update the tenant's destination wallet (spec 06). The wallet is
 * validated as a Testnet StrKey (shared schema → `INVALID_STELLAR_PUBLIC_KEY` /
 * `UNSUPPORTED_NETWORK`) and then verified to actually exist on-chain via Horizon
 * (`STELLAR_ACCOUNT_NOT_FOUND`), so a well-formed but non-existent account is never stored.
 * RN-09: a change is blocked while the tenant has open (`CREATED`/`ACTIVE`) orders
 * (`WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS`). Historical orders keep their copied wallet (RN-03).
 */
export class AssignTenantWallet {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly orders: PaymentOrderRepository,
    private readonly clock: Clock,
    private readonly stellar: StellarAccountVerifier,
  ) {}

  async execute(tenantId: string, input: unknown): Promise<TenantWalletView> {
    const wallet = validate(AssignTenantWalletInputSchema, input);

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found', { id: tenantId });
    }

    if (await this.tenants.existsByWallet(wallet.publicKey, tenantId)) {
      throw conflict('TENANT_WALLET_CONFLICT', 'A tenant with this wallet already exists', {
        publicKey: wallet.publicKey,
      });
    }

    if (!(await this.stellar.exists(wallet))) {
      throw unprocessable(
        'STELLAR_ACCOUNT_NOT_FOUND',
        'The wallet does not exist on the Stellar network',
        { publicKey: wallet.publicKey },
      );
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
