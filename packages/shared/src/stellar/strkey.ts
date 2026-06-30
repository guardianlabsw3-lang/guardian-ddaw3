/**
 * Minimal, dependency-free StrKey (SEP-0023) helpers for Stellar ed25519 account
 * public keys. Implemented here so that `@payorder/shared` can validate keys in any
 * runtime (Node API/worker and the browser) without pulling the full Stellar SDK.
 *
 * An ed25519 account public key ("G...") encodes 35 bytes as base32 (RFC 4648, no
 * padding) → exactly 56 characters:
 *   byte[0]      version byte (0x30 for ed25519 public key → renders as "G")
 *   byte[1..33]  the 32-byte raw ed25519 public key
 *   byte[33..35] CRC16-XModem checksum of byte[0..33], little-endian
 */

/** Version byte for an ed25519 account public key (6 << 3). Renders the "G" prefix. */
export const ED25519_PUBLIC_KEY_VERSION_BYTE = 0x30;

/** Version byte for an ed25519 secret seed (18 << 3). Renders the "S" prefix. */
export const ED25519_SECRET_SEED_VERSION_BYTE = 0x90;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const BASE32_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE32_ALPHABET.length; i += 1) {
    table[BASE32_ALPHABET[i]!] = i;
  }
  return table;
})();

/**
 * Decode an unpadded RFC 4648 base32 string into bytes.
 * Returns `null` if the input contains characters outside the alphabet.
 */
export function base32Decode(input: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of input) {
    const idx = BASE32_LOOKUP[char];
    if (idx === undefined) {
      return null;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return Uint8Array.from(output);
}

/**
 * CRC16-XModem (poly 0x1021, init 0x0000) — the checksum used by Stellar StrKey.
 */
export function crc16(data: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    let code = (crc >>> 8) & 0xff;
    code ^= byte & 0xff;
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }
  return crc & 0xffff;
}

/**
 * Validate an ed25519 account public key ("G..."): correct length, version byte,
 * alphabet and CRC16 checksum.
 */
export function isValidEd25519PublicKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length !== 56 || key[0] !== 'G') {
    return false;
  }

  const decoded = base32Decode(key);
  // 1 version byte + 32 key bytes + 2 checksum bytes
  if (decoded === null || decoded.length !== 35) {
    return false;
  }

  if (decoded[0] !== ED25519_PUBLIC_KEY_VERSION_BYTE) {
    return false;
  }

  const payload = decoded.subarray(0, 33);
  const expected = crc16(payload);
  const actual = decoded[33]! | (decoded[34]! << 8); // little-endian
  return expected === actual;
}

/**
 * Validate an ed25519 secret seed ("S..."): correct length, version byte, alphabet
 * and CRC16 checksum. Same 35-byte StrKey layout as a public key, only the prefix
 * and version byte differ. Useful to fail fast on a misconfigured admin secret
 * (e.g. a "G..." public key pasted in place of a "S..." seed) before the Stellar
 * SDK throws a cryptic "invalid version byte" deep inside `Keypair.fromSecret`.
 */
export function isValidEd25519SecretSeed(seed: unknown): seed is string {
  if (typeof seed !== 'string' || seed.length !== 56 || seed[0] !== 'S') {
    return false;
  }

  const decoded = base32Decode(seed);
  // 1 version byte + 32 seed bytes + 2 checksum bytes
  if (decoded === null || decoded.length !== 35) {
    return false;
  }

  if (decoded[0] !== ED25519_SECRET_SEED_VERSION_BYTE) {
    return false;
  }

  const payload = decoded.subarray(0, 33);
  const expected = crc16(payload);
  const actual = decoded[33]! | (decoded[34]! << 8); // little-endian
  return expected === actual;
}
