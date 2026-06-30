import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API-key minting and verification (spec 08 §6, spec 09 §9). A key is `pk_<prefix>.<secret>`:
 * the **prefix** is a public, indexable lookup handle; the **secret** is high-entropy and
 * stored only as a SHA-256 hash (a fast hash is sufficient given the entropy — argon2 is
 * reserved for low-entropy passwords). The plaintext is shown to the integrator exactly once.
 */
export interface GeneratedApiKey {
  /** Full secret to hand to the integrator once: `pk_<prefix>.<secret>`. */
  plaintext: string;
  prefix: string;
  keyHash: string;
}

const PREFIX_BYTES = 6;
const SECRET_BYTES = 24;

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(PREFIX_BYTES).toString('hex');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return {
    plaintext: `pk_${prefix}.${secret}`,
    prefix,
    keyHash: hashSecret(secret),
  };
}

/** SHA-256 hex of a secret (key secret or webhook secret). */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface ParsedApiKey {
  prefix: string;
  secret: string;
}

/** Parse an `pk_<prefix>.<secret>` presentation, returning null when malformed. */
export function parseApiKey(presented: string): ParsedApiKey | null {
  if (!presented.startsWith('pk_')) {
    return null;
  }
  const rest = presented.slice(3);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) {
    return null;
  }
  return { prefix: rest.slice(0, dot), secret: rest.slice(dot + 1) };
}

/** Constant-time comparison of a presented secret against the stored hash. */
export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
