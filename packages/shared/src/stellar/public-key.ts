import { z } from 'zod';
import { isValidEd25519PublicKey } from './strkey.js';

/**
 * `StellarPublicKey` value object: an ed25519 account public key ("G...", 56 chars,
 * valid StrKey checksum). Validation matches the on-chain/off-chain contract used by
 * `tenants` and `payment_orders` (see specs 03/05/06 and 09-data-model).
 */

/** Shallow structural pattern (prefix + length). Checksum is enforced separately. */
export const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

export const StellarPublicKeySchema = z
  .string()
  .refine(isValidEd25519PublicKey, { message: 'INVALID_STELLAR_PUBLIC_KEY' })
  .brand<'StellarPublicKey'>();

export type StellarPublicKey = z.infer<typeof StellarPublicKeySchema>;

export function isValidStellarPublicKey(value: unknown): value is StellarPublicKey {
  return isValidEd25519PublicKey(value);
}

/**
 * Parse and brand a Stellar public key. Throws (zod) when invalid.
 */
export function toStellarPublicKey(value: string): StellarPublicKey {
  return StellarPublicKeySchema.parse(value);
}
