import { EmailSchema } from '@payorder/shared';
import type { TenantRepository } from '../ports/index.js';
import { validate } from '../shared/errors.js';

export interface OnboardingStatusView {
  hasWallet: boolean;
}

/**
 * Read-only onboarding status for the authenticated admin (feature
 * "onboarding-wallet-required"). Exempt from `walletRequiredMiddleware` so the panel can
 * always tell whether it must show the mandatory connect-wallet step — even before a tenant
 * exists (no tenant yet reads the same as "no wallet yet").
 */
export class GetOnboardingStatus {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(adminEmail: unknown): Promise<OnboardingStatusView> {
    const email = validate(EmailSchema, adminEmail);
    const tenant = await this.tenants.findByAdminEmail(email);
    return { hasWallet: tenant?.wallet != null };
  }
}
