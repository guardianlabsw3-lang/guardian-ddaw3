import { randomInt } from 'node:crypto';
import type { SlugGenerator } from '../../application/ports/index.js';

/** Bitcoin/base58 alphabet (no 0, O, I, l) — unambiguous, URL-safe. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Public payment slugs are prefixed and at least this many random chars (spec 03 §4). */
const PUBLIC_SLUG_RANDOM_LENGTH = 22;
const PUBLIC_SLUG_PREFIX = 'p_';
const MAX_TENANT_SLUG_LENGTH = 60;

/**
 * `SlugGenerator` adapter. Tenant slugs are derived from the name (URL-safe, deterministic
 * shape); public payment slugs are opaque, non-sequential base58 strings so payment links
 * cannot be enumerated (RF-12).
 */
export class Base58SlugGenerator implements SlugGenerator {
  tenantSlug(seed: string): string {
    const slug = seed
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_TENANT_SLUG_LENGTH)
      .replace(/-+$/g, '');
    return slug.length > 0 ? slug : this.randomBase58(8);
  }

  publicPaymentSlug(): string {
    return `${PUBLIC_SLUG_PREFIX}${this.randomBase58(PUBLIC_SLUG_RANDOM_LENGTH)}`;
  }

  private randomBase58(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += BASE58_ALPHABET[randomInt(BASE58_ALPHABET.length)];
    }
    return out;
  }
}
