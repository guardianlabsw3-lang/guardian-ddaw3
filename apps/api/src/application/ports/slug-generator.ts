/**
 * `SlugGenerator` port (spec 03 §7). Tenant slugs are URL-safe and derived from a seed
 * (the name); public payment slugs are **opaque and non-sequential** (≥ 22 base58 chars,
 * spec 03 §4 / RF-12) so links cannot be enumerated.
 */
export interface SlugGenerator {
  /** Derive a URL-safe slug candidate from a human seed (e.g. the tenant name). */
  tenantSlug(seed: string): string;
  /** A fresh opaque, non-sequential public payment slug (e.g. `p_8sKd9...`). */
  publicPaymentSlug(): string;
}
