import { EmailSchema } from '@payorder/shared';
import type { TenantRepository } from '../ports/index.js';
import { validate } from '../shared/errors.js';
import type { AssignTenantWallet } from './assign-tenant-wallet.js';
import type { CreateTenant } from './create-tenant.js';
import { toTenantView, type TenantView } from './views.js';

/**
 * Self-service onboarding (feature "wallet-connect-registration"). Right after an admin
 * registers, the panel prompts them to connect a Stellar wallet; this use case persists that
 * wallet against the admin's tenant so future orders can resolve a destination (RN-01/RN-02).
 *
 * The admin account and the tenant are distinct aggregates, so the tenant is keyed off the
 * admin's email: on first connect a tenant is auto-created (seeded from the email, with an
 * editable placeholder name/document the admin can complete later in the panel); a subsequent
 * connect just re-assigns the wallet on the existing tenant (idempotent, RN-09 still applies).
 */
export class OnboardTenantWallet {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly createTenant: CreateTenant,
    private readonly assignWallet: AssignTenantWallet,
  ) {}

  async execute(adminEmail: unknown, wallet: unknown): Promise<TenantView> {
    const email = validate(EmailSchema, adminEmail);

    const existing = await this.tenants.findByAdminEmail(email);
    if (existing) {
      // Reuse the wallet-assignment rules (validation + RN-09 active-order guard). The mutated
      // aggregate is re-read to build the full tenant view returned to the panel.
      await this.assignWallet.execute(existing.id, wallet);
      const updated = await this.tenants.findById(existing.id);
      return toTenantView(updated!);
    }

    return this.createTenant.execute({
      name: placeholderName(email),
      legalName: placeholderName(email),
      document: { type: 'OTHER', number: email },
      adminEmail: email,
      defaultAsset: { code: 'XLM', issuer: null },
      wallet,
    });
  }
}

/** Derive a friendly, editable tenant name from the admin email's local part. */
function placeholderName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length > 0 ? local : email;
}
