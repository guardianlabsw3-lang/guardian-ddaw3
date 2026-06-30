import { z } from 'zod';

/**
 * Common primitive value-object schemas reused across tenant and payment-order
 * contracts. See spec 03-domain-model §4.
 */

/** UUID (v4/v7). */
export const UuidSchema = z.string().uuid();

/**
 * `Email` — RFC 5322 (simplified). Emits `INVALID_EMAIL` (spec 05 §7).
 */
export const EmailSchema = z.string().trim().min(3).max(254).email({ message: 'INVALID_EMAIL' });

export type Email = z.infer<typeof EmailSchema>;

/**
 * `Slug` — URL-safe, lowercase, hyphen/underscore separated. Public payment slugs are
 * opaque and non-sequential (spec 03 §4); this validates the general slug shape.
 */
export const SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

export const SlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(SLUG_PATTERN, { message: 'INVALID_SLUG' });

export type Slug = z.infer<typeof SlugSchema>;
