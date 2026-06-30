import { z } from 'zod';
import { UuidSchema, EmailSchema, SlugSchema } from './common.js';
import { DocumentSchema } from './document.js';
import { AssetSchema } from './asset.js';
import { StellarAccountSchema } from '../stellar/account.js';

/**
 * Tenant contracts (zod) for onboarding and representation. These are the executable
 * contract behind spec 05-tenant-onboarding; they validate documents, email, default
 * asset/issuer, and the (optional at creation) Stellar Testnet wallet.
 */

export const TENANT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const TenantStatusSchema = z.enum(TENANT_STATUSES);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

/**
 * Input to create a tenant. The wallet is optional at creation — a tenant can only
 * issue orders once it is `ACTIVE` and has a wallet (spec 05 §6). `defaultAsset`
 * enforces issuer presence for non-native assets (ASSET_ISSUER_REQUIRED).
 */
export const CreateTenantInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200),
  document: DocumentSchema,
  adminEmail: EmailSchema,
  defaultAsset: AssetSchema,
  wallet: StellarAccountSchema.optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantInputSchema>;

/**
 * Input to assign / update a tenant wallet (spec 06 — PUT /api/tenants/{id}/wallet).
 */
export const AssignTenantWalletInputSchema = StellarAccountSchema;
export type AssignTenantWalletInput = z.infer<typeof AssignTenantWalletInputSchema>;

/**
 * Full tenant representation (the persisted aggregate, camelCase domain shape).
 */
export const TenantSchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  name: z.string().min(1),
  legalName: z.string().min(1),
  document: DocumentSchema,
  adminEmail: EmailSchema,
  wallet: StellarAccountSchema.nullable(),
  defaultAsset: AssetSchema,
  status: TenantStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Tenant = z.infer<typeof TenantSchema>;
