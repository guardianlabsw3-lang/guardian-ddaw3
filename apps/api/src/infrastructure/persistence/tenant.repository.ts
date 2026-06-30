import { and, count, eq, sql } from 'drizzle-orm';
import type { TenantStatus } from '@payorder/shared';
import type { Tenant } from '../../domain/tenant/index.js';
import type { Page, TenantListFilter, TenantRepository } from '../../application/ports/index.js';
import type { Database } from './db.js';
import { tenants } from './schema/tenants.js';
import { tenantFromRow, tenantToRow } from './mappers/tenant.mapper.js';

/**
 * Drizzle-backed `TenantRepository` (TASK-013). `save` upserts by primary key so the same
 * method serves onboarding and later mutations (wallet/status). Queries by id/slug/document
 * back the resolution paths used during order creation (RF-05).
 */
export class DrizzleTenantRepository implements TenantRepository {
  constructor(private readonly db: Database) {}

  async save(tenant: Tenant): Promise<void> {
    const row = tenantToRow(tenant);
    await this.db
      .insert(tenants)
      .values(row)
      .onConflictDoUpdate({
        target: tenants.id,
        set: {
          slug: row.slug,
          name: row.name,
          legalName: row.legalName,
          adminEmail: row.adminEmail,
          stellarWalletPublicKey: row.stellarWalletPublicKey,
          stellarNetwork: row.stellarNetwork,
          defaultAssetCode: row.defaultAssetCode,
          defaultAssetIssuer: row.defaultAssetIssuer,
          status: row.status,
          updatedAt: row.updatedAt,
        },
      });
  }

  async findById(id: string): Promise<Tenant | null> {
    const [row] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return row ? tenantFromRow(row) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const [row] = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return row ? tenantFromRow(row) : null;
  }

  async findByDocument(documentNumber: string): Promise<Tenant | null> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.documentNumber, documentNumber))
      .limit(1);
    return row ? tenantFromRow(row) : null;
  }

  async existsByDocument(documentNumber: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.documentNumber, documentNumber))
      .limit(1);
    return row !== undefined;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  async list(filter: TenantListFilter): Promise<Page<Tenant>> {
    const conditions = [];
    if (filter.status) {
      conditions.push(eq(tenants.status, filter.status satisfies TenantStatus));
    }
    if (filter.document) {
      conditions.push(eq(tenants.documentNumber, filter.document));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(tenants)
        .where(where)
        .orderBy(sql`${tenants.createdAt} desc`)
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(tenants).where(where),
    ]);

    return { items: rows.map(tenantFromRow), total: totals?.value ?? 0 };
  }
}
