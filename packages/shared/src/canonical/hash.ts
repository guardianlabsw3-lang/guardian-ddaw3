import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalize, type CanonicalOrderInput } from './canonicalize.js';

/**
 * SHA-256 of the canonical payload, rendered as a lowercase 64-char hex string. This is
 * the `canonical_payload_hash` registered on-chain and shown on the public page for
 * verification (spec 03 §5). Using a single implementation here prevents hash divergence
 * between api, worker and web (TASK-005 risk).
 */

/** `Sha256Hash` value object: lowercase hex, exactly 64 chars. */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const Sha256HashSchema = z
  .string()
  .regex(SHA256_HEX_PATTERN, { message: 'INVALID_SHA256_HASH' })
  .brand<'Sha256Hash'>();

export type Sha256Hash = z.infer<typeof Sha256HashSchema>;

/** SHA-256 hex of arbitrary bytes/string. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the canonical payload hash for a payment order.
 */
export function canonicalPayloadHash(input: CanonicalOrderInput): string {
  return sha256Hex(canonicalize(input));
}

export function isValidSha256Hash(value: unknown): value is Sha256Hash {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}
