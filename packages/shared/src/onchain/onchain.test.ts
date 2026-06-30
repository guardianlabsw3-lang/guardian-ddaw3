import { describe, it, expect } from 'vitest';
import {
  deriveOrderRef,
  deriveTenantRef,
  onChainRefBytes,
  isValidOnChainRef,
  BYTES32_HEX_PATTERN,
} from './order-ref.js';

const ORDER_ID = '00000000-0000-7000-8000-0000000000a1';

describe('on-chain reference derivation', () => {
  it('derives a deterministic 64-hex (32-byte) reference', () => {
    const ref = deriveOrderRef(ORDER_ID);
    expect(ref).toMatch(BYTES32_HEX_PATTERN);
    expect(ref).toBe(deriveOrderRef(ORDER_ID)); // stable across calls
    expect(isValidOnChainRef(ref)).toBe(true);
  });

  it('produces different references for different ids', () => {
    const tenantId = '00000000-0000-7000-8000-0000000000b2';
    expect(deriveOrderRef(ORDER_ID)).not.toBe(deriveTenantRef(tenantId));
  });

  it('round-trips the hex reference to exactly 32 bytes', () => {
    const ref = deriveOrderRef(ORDER_ID);
    const bytes = onChainRefBytes(ref);
    expect(bytes).toHaveLength(32);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toBe(ref);
  });

  it('rejects malformed references', () => {
    expect(isValidOnChainRef('xyz')).toBe(false);
    expect(isValidOnChainRef('AB'.repeat(32))).toBe(false); // uppercase
  });
});
