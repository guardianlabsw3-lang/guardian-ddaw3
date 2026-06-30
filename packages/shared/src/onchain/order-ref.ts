import { z } from 'zod';
import { sha256Hex } from '../canonical/hash.js';

/**
 * Deterministic 32-byte references used on-chain (`BytesN<32>`). The Soroban contract keys
 * orders by `order_id` and stores a `tenant_ref`, both fixed at 32 bytes (spec 07 §2/§9).
 * Off-chain ids are UUID strings, so they are folded into 32 bytes deterministically — via
 * SHA-256 of the id — so api, worker and web all derive the **same** reference and can
 * correlate on-chain state back to the off-chain record.
 *
 * Living in `@payorder/shared` keeps this mapping a single source of truth, exactly like the
 * canonical-payload hash (TASK-005), preventing divergence between services.
 */

/** A 32-byte on-chain reference rendered as a lowercase 64-char hex string. */
export const BYTES32_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const OnChainRefSchema = z
  .string()
  .regex(BYTES32_HEX_PATTERN, { message: 'INVALID_ONCHAIN_REF' })
  .brand<'OnChainRef'>();

export type OnChainRef = z.infer<typeof OnChainRefSchema>;

/** Fold an arbitrary identifier into a deterministic 32-byte (64-hex) reference. */
export function deriveOnChainRef(id: string): OnChainRef {
  return sha256Hex(id) as OnChainRef;
}

/** On-chain `order_id` reference derived from the off-chain order UUID. */
export function deriveOrderRef(orderId: string): OnChainRef {
  return deriveOnChainRef(orderId);
}

/** On-chain `tenant_ref` derived from the off-chain tenant UUID. */
export function deriveTenantRef(tenantId: string): OnChainRef {
  return deriveOnChainRef(tenantId);
}

/** The raw 32 bytes for a derived reference (for building `BytesN<32>` ScVals). */
export function onChainRefBytes(ref: OnChainRef): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(ref.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function isValidOnChainRef(value: unknown): value is OnChainRef {
  return typeof value === 'string' && BYTES32_HEX_PATTERN.test(value);
}
