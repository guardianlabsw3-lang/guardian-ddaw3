import type {
  GetOnboardingStatus,
  OnboardTenantWallet,
} from '../../../application/tenant/index.js';
import type { AuditLogger } from '../../../application/ports/index.js';
import { unauthorized } from '../../../application/shared/errors.js';
import { auditActor as actor } from '../audit-actor.js';
import { tenantResponse, toAssignWalletInput } from '../dto.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';

export interface OnboardingControllerDeps {
  onboardWallet: OnboardTenantWallet;
  getStatus: GetOnboardingStatus;
  audit: AuditLogger;
}

/**
 * Self-service onboarding endpoints (feature "wallet-connect-registration", hardened by
 * "onboarding-wallet-required"). `POST` is invoked right after registration when the admin
 * connects a wallet in the panel: it saves the connected public key to the admin's tenant
 * (auto-creating one on first connect). `GET` lets the panel check whether the connect-wallet
 * gate must be shown — for a fresh account, before a tenant is auto-created, or after a
 * previous attempt was abandoned. Both are admin-only (JWT) and, unlike every other admin
 * route, exempt from `walletRequiredMiddleware` — otherwise a walletless admin could never
 * reach the one endpoint that lets it link one. The tenant is always resolved from the
 * authenticated admin's email, never from the request body.
 */
export function onboardingRoutes(deps: OnboardingControllerDeps): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/onboarding/wallet',
      auth: 'admin',
      walletExempt: true,
      handler: async (req) => {
        const email = req.principal?.label;
        if (!email) {
          throw unauthorized('UNAUTHENTICATED', 'Authentication required');
        }
        const view = await deps.onboardWallet.execute(email, toAssignWalletInput(req.json()));
        await deps.audit.record({
          ...actor(req.principal),
          action: 'tenant.wallet.onboard',
          entityType: 'tenant',
          entityId: view.id,
          correlationId: req.requestId,
          diff: { walletPublicKey: view.wallet?.publicKey, network: view.wallet?.network },
        });
        return json(200, tenantResponse(view));
      },
    },
    {
      method: 'GET',
      path: '/api/onboarding/wallet',
      auth: 'admin',
      walletExempt: true,
      handler: async (req) => {
        const email = req.principal?.label;
        if (!email) {
          throw unauthorized('UNAUTHENTICATED', 'Authentication required');
        }
        const status = await deps.getStatus.execute(email);
        return json(200, { has_wallet: status.hasWallet });
      },
    },
  ];
}
