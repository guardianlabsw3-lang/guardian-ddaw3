import { describe, it, expect } from 'vitest';
import { formatStellarAmount } from './amount.js';
import {
  canonicalize,
  buildCanonicalPayload,
  stableStringify,
  type CanonicalOrderInput,
} from './canonicalize.js';
import { canonicalPayloadHash, sha256Hex, Sha256HashSchema } from './hash.js';

describe('formatStellarAmount', () => {
  it('normalizes to exactly 7 decimal places', () => {
    expect(formatStellarAmount('150')).toBe('150.0000000');
    expect(formatStellarAmount('150.0000000')).toBe('150.0000000');
    expect(formatStellarAmount('0.1')).toBe('0.1000000');
    expect(formatStellarAmount(150)).toBe('150.0000000');
    expect(formatStellarAmount('00150.5')).toBe('150.5000000');
  });

  it('rejects invalid amounts and excess precision', () => {
    expect(() => formatStellarAmount('1.23456789')).toThrow(); // 8 decimals
    expect(() => formatStellarAmount('abc')).toThrow();
    expect(() => formatStellarAmount('-5')).toThrow();
    expect(() => formatStellarAmount('')).toThrow();
  });
});

describe('canonicalization', () => {
  const input: CanonicalOrderInput = {
    orderId: '0f9d1c2e',
    tenantId: 'tenant_123',
    receiverWallet: 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
    amount: '150',
    assetCode: 'XLM',
    assetIssuer: null,
    externalId: 'ORDER-123456',
    dueDate: '2026-07-10',
  };

  const expectedJson =
    '{"amount":"150.0000000",' +
    '"asset_code":"XLM",' +
    '"asset_issuer":"",' +
    '"due_date":"2026-07-10",' +
    '"external_id":"ORDER-123456",' +
    '"order_id":"0f9d1c2e",' +
    '"receiver_wallet":"GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ",' +
    '"tenant_id":"tenant_123",' +
    '"version":1}';

  it('produces lexicographically-sorted, compact JSON', () => {
    expect(canonicalize(input)).toBe(expectedJson);
  });

  it('is deterministic regardless of source field order', () => {
    const reordered: CanonicalOrderInput = {
      dueDate: '2026-07-10',
      amount: '150',
      tenantId: 'tenant_123',
      assetCode: 'XLM',
      orderId: '0f9d1c2e',
      receiverWallet: 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
      externalId: 'ORDER-123456',
      assetIssuer: null,
    };
    expect(canonicalize(reordered)).toBe(canonicalize(input));
    expect(canonicalPayloadHash(reordered)).toBe(canonicalPayloadHash(input));
  });

  it('null issuer becomes empty string; null externalId/dueDate become empty string', () => {
    const payload = buildCanonicalPayload({
      orderId: 'o1',
      tenantId: 't1',
      receiverWallet: 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
      amount: '1',
      assetCode: 'XLM',
      assetIssuer: null,
    });
    expect(payload.asset_issuer).toBe('');
    expect(payload.external_id).toBe('');
    expect(payload.due_date).toBe('');
    expect(payload.version).toBe(1);
  });

  it('amount scale change does not change the hash for equivalent values', () => {
    expect(canonicalPayloadHash({ ...input, amount: '150.0000000' })).toBe(
      canonicalPayloadHash({ ...input, amount: '150' }),
    );
  });

  it('different amount changes the hash', () => {
    expect(canonicalPayloadHash({ ...input, amount: '151' })).not.toBe(canonicalPayloadHash(input));
  });

  it('accepts a Date for dueDate and keeps the date component only', () => {
    const withDate = buildCanonicalPayload({
      ...input,
      dueDate: new Date('2026-07-10T23:59:59.000Z'),
    });
    expect(withDate.due_date).toBe('2026-07-10');
  });

  it('hash is a valid lowercase 64-char hex (Sha256Hash)', () => {
    const hash = canonicalPayloadHash(input);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(() => Sha256HashSchema.parse(hash)).not.toThrow();
    // Cross-check against hashing the canonical bytes directly.
    expect(hash).toBe(sha256Hex(expectedJson));
  });
});

describe('stableStringify', () => {
  it('sorts nested object keys and preserves array order', () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('throws on non-finite numbers', () => {
    expect(() => stableStringify(Number.NaN)).toThrow();
  });
});
