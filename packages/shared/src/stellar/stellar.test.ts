import { describe, it, expect } from 'vitest';
import { isValidEd25519PublicKey, crc16, base32Decode } from './strkey.js';
import { StellarPublicKeySchema, isValidStellarPublicKey } from './public-key.js';
import { StellarAccountSchema } from './account.js';
import { StellarNetworkSchema, isSupportedNetwork, TESTNET } from './network.js';

// Real, checksum-valid ed25519 account public keys (generated with @stellar/stellar-sdk).
const VALID_KEYS = [
  'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
  'GCRYRCRH6YPJVCXNPFVU2CC4QHGISIX4DOIRED4VCNXBAJUW75KRJMGU',
  'GB7BOUQ3MN6PT23V5IQY6EJKD2UFZS3M5W4JVBYO37PTP6U7S626QHG7',
];

describe('strkey / StellarPublicKey', () => {
  it('accepts real, checksum-valid public keys', () => {
    for (const key of VALID_KEYS) {
      expect(isValidEd25519PublicKey(key)).toBe(true);
      expect(isValidStellarPublicKey(key)).toBe(true);
      expect(() => StellarPublicKeySchema.parse(key)).not.toThrow();
    }
  });

  it('rejects keys with a corrupted checksum', () => {
    const key = VALID_KEYS[0]!;
    // Flip the last character → checksum no longer matches.
    const corrupted = key.slice(0, -1) + (key.endsWith('Z') ? 'A' : 'Z');
    expect(isValidEd25519PublicKey(corrupted)).toBe(false);
  });

  it('rejects wrong prefix, wrong length and non-base32 characters', () => {
    expect(
      isValidEd25519PublicKey('SB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ'),
    ).toBe(false);
    expect(isValidEd25519PublicKey('GABC')).toBe(false);
    expect(isValidEd25519PublicKey(VALID_KEYS[0]!.slice(0, -1) + '1')).toBe(false); // '1' not in alphabet
    expect(isValidEd25519PublicKey(VALID_KEYS[0]!.slice(0, -1) + '0')).toBe(false); // '0' not in alphabet
    expect(isValidEd25519PublicKey('')).toBe(false);
    expect(isValidEd25519PublicKey(123 as unknown)).toBe(false);
  });

  it('base32Decode returns null on invalid input', () => {
    expect(base32Decode('0189')).toBeNull();
  });

  it('crc16 is deterministic', () => {
    const bytes = Uint8Array.from([0x30, 0x01, 0x02, 0x03]);
    expect(crc16(bytes)).toBe(crc16(bytes));
  });
});

describe('StellarNetwork', () => {
  it('accepts TESTNET only', () => {
    expect(isSupportedNetwork('TESTNET')).toBe(true);
    expect(StellarNetworkSchema.parse('TESTNET')).toBe(TESTNET);
  });

  it('rejects MAINNET / PUBLIC and others with UNSUPPORTED_NETWORK', () => {
    expect(isSupportedNetwork('PUBLIC')).toBe(false);
    expect(isSupportedNetwork('MAINNET')).toBe(false);
    const result = StellarNetworkSchema.safeParse('MAINNET');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('UNSUPPORTED_NETWORK');
    }
  });
});

describe('StellarAccount', () => {
  it('binds a valid public key to TESTNET', () => {
    const account = StellarAccountSchema.parse({ publicKey: VALID_KEYS[0], network: 'TESTNET' });
    expect(account.publicKey).toBe(VALID_KEYS[0]);
    expect(account.network).toBe('TESTNET');
  });

  it('rejects an account on an unsupported network', () => {
    expect(
      StellarAccountSchema.safeParse({ publicKey: VALID_KEYS[0], network: 'MAINNET' }).success,
    ).toBe(false);
  });

  it('rejects an account with an invalid public key', () => {
    expect(StellarAccountSchema.safeParse({ publicKey: 'GABC', network: 'TESTNET' }).success).toBe(
      false,
    );
  });
});
