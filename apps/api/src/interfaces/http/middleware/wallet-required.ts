import type { TenantRepository } from '../../../application/ports/index.js';
import { forbidden } from '../../../application/shared/errors.js';
import type { Middleware } from '../types.js';

export interface WalletRequiredDeps {
  tenants: TenantRepository;
}

/**
 * Closes the "account created but never linked a wallet" gap (feature
 * "onboarding-wallet-required", spec 05 §3/§6): once authenticated, a self-service admin
 * (non-root) may reach nothing beyond the onboarding-wallet routes until the tenant onboarded
 * under its email has a Stellar wallet — including one auto-created without a wallet by an
 * earlier connect that was abandoned. Root admins operate tenants on others' behalf and are
 * unaffected; API-key principals are a distinct concern (per-key tenant allowlist) and skip
 * this check entirely.
 */
export function walletRequiredMiddleware(deps: WalletRequiredDeps): Middleware {
  return async (req, next) => {
    const route = req.route;
    const principal = req.principal;
    if (
      !route ||
      route.walletExempt ||
      !principal ||
      principal.kind !== 'admin' ||
      principal.isRootAdmin ||
      !principal.adminEmail
    ) {
      return next(req);
    }

    const tenant = await deps.tenants.findByAdminEmail(principal.adminEmail);
    if (!tenant || tenant.wallet === null) {
      throw forbidden(
        'WALLET_REQUIRED',
        'Connect a Stellar wallet to your account before continuing',
      );
    }
    return next(req);
  };
}
