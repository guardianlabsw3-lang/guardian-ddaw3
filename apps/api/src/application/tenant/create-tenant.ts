import { CreateTenantInputSchema, SlugSchema } from '@payorder/shared';
import { Tenant } from '../../domain/tenant/index.js';
import type { Clock, IdGenerator, SlugGenerator, TenantRepository } from '../ports/index.js';
import { conflict, validate } from '../shared/errors.js';
import { toTenantView, type TenantView } from './views.js';

/**
 * UC-01 onboarding (spec 05). Validates input (shared zod), enforces document uniqueness
 * (`TENANT_DOCUMENT_CONFLICT`), generates a unique URL-safe slug, and persists the tenant
 * `INACTIVE` per the activation policy (spec 05 §6) — a wallet may be supplied now or later,
 * but the tenant only becomes `ACTIVE` via `ActivateTenant`.
 */
export class CreateTenant {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly ids: IdGenerator,
    private readonly slugs: SlugGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: unknown): Promise<TenantView> {
    const data = validate(CreateTenantInputSchema, input);

    if (await this.tenants.existsByDocument(data.document.number)) {
      throw conflict('TENANT_DOCUMENT_CONFLICT', 'A tenant with this document already exists', {
        documentNumber: data.document.number,
      });
    }

    const slug = await this.ensureUniqueSlug(data.name);
    const tenant = Tenant.create({
      id: this.ids.uuid(),
      slug,
      name: data.name,
      legalName: data.legalName,
      document: data.document,
      adminEmail: data.adminEmail,
      defaultAsset: data.defaultAsset,
      wallet: data.wallet ?? null,
      now: this.clock.now(),
    });

    await this.tenants.save(tenant);
    return toTenantView(tenant);
  }

  private async ensureUniqueSlug(seed: string) {
    const base = this.slugs.tenantSlug(seed);
    if (!(await this.tenants.existsBySlug(base))) {
      return SlugSchema.parse(base);
    }
    for (let i = 2; i <= 50; i += 1) {
      const candidate = `${base}-${i}`;
      if (!(await this.tenants.existsBySlug(candidate))) {
        return SlugSchema.parse(candidate);
      }
    }
    return SlugSchema.parse(`${base}-${this.slugs.publicPaymentSlug().slice(2, 8)}`);
  }
}
