import type { TenantStatus } from '@payorder/shared';
import type { Tenant } from '../../domain/tenant/index.js';

export interface TenantListFilter {
  status?: TenantStatus;
  /** Substring/exact match on the (normalized) document number. */
  document?: string;
  /** Restrict to tenants onboarded under this admin email (per-admin visibility scoping). */
  adminEmail?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/**
 * `TenantRepository` port (spec 03 §7). The application depends on this interface only;
 * the Drizzle implementation lives in infrastructure (Hexagonal). `save` persists the
 * aggregate (insert or update) together with any pulled domain events where relevant.
 */
export interface TenantRepository {
  save(tenant: Tenant): Promise<void>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findByDocument(documentNumber: string): Promise<Tenant | null>;
  /** Resolve the tenant onboarded under an admin email (self-service onboarding). */
  findByAdminEmail(adminEmail: string): Promise<Tenant | null>;
  existsByDocument(documentNumber: string): Promise<boolean>;
  existsBySlug(slug: string): Promise<boolean>;
  /**
   * Whether some tenant already holds this destination wallet (ADR-04: one wallet backs at
   * most one tenant). `excludeTenantId` skips the tenant being updated so re-saving its own
   * wallet is not treated as a conflict.
   */
  existsByWallet(publicKey: string, excludeTenantId?: string): Promise<boolean>;
  list(filter: TenantListFilter): Promise<Page<Tenant>>;
}
