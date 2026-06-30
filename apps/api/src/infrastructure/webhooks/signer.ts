import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook HMAC signing (spec 08 §5, spec 10 §6). The signature covers `"<timestamp>.<body>"`
 * so the timestamp is authenticated and the consumer can reject replays outside a tolerance
 * window. Header format: `X-PayOrder-Signature: t=<unix_ts>,v1=<hmac_sha256_hex>`.
 */
export function buildSignatureHeader(
  secret: string,
  body: string,
  timestampSeconds: number,
): string {
  const v1 = hmacHex(secret, `${timestampSeconds}.${body}`);
  return `t=${timestampSeconds},v1=${v1}`;
}

function hmacHex(secret: string, signingInput: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('hex');
}

export interface ParsedSignature {
  timestamp: number;
  v1: string;
}

export function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: number | null = null;
  let v1: string | null = null;
  for (const part of parts) {
    const [k, v] = part.split('=', 2);
    if (k === 't' && v) {
      timestamp = Number(v);
    } else if (k === 'v1' && v) {
      v1 = v;
    }
  }
  if (timestamp === null || Number.isNaN(timestamp) || v1 === null) {
    return null;
  }
  return { timestamp, v1 };
}

/**
 * Verify a signature header against the body and secret, enforcing a freshness tolerance to
 * defeat replays (spec 10 §6). Used by integrators and by our own tests/mock receiver.
 */
export function verifySignatureHeader(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return false;
  }
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = hmacHex(secret, `${parsed.timestamp}.${body}`);
  const a = Buffer.from(parsed.v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
