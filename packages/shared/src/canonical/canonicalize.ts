import { formatStellarAmount } from './amount.js';

/**
 * Deterministic canonicalization of the payment-order fields that are relevant to the
 * integrity of the payment. The same logical order must always produce the same bytes
 * (and therefore the same SHA-256 hash) regardless of the service computing it — see
 * spec 03-domain-model §5.
 *
 * Rules:
 * - JSON with keys sorted lexicographically, no whitespace, UTF-8.
 * - `amount` is a fixed-scale (7) decimal string.
 * - `asset_issuer` null/absent → empty string `""` (the key is never omitted).
 * - `due_date` is date-only ISO (`YYYY-MM-DD`); absent → `""`.
 * - `version` defaults to 1.
 * - `description` and `metadata` are intentionally **excluded** (not payment-determining).
 */

export const CANONICAL_PAYLOAD_VERSION = 1;

export interface CanonicalOrderInput {
  orderId: string;
  tenantId: string;
  receiverWallet: string;
  amount: string | number;
  assetCode: string;
  assetIssuer?: string | null;
  externalId?: string | null;
  dueDate?: string | Date | null;
  version?: number;
}

/**
 * The exact, normalized field set that is hashed. Keys are snake_case to match the
 * on-chain/cross-service contract documented in the spec.
 */
export interface CanonicalPayload {
  amount: string;
  asset_code: string;
  asset_issuer: string;
  due_date: string;
  external_id: string;
  order_id: string;
  receiver_wallet: string;
  tenant_id: string;
  version: number;
}

function toDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError('Invalid dueDate');
    }
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  // Accept either a date-only or a full ISO timestamp; keep the date component only.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (!match) {
    throw new RangeError(`Invalid dueDate: "${value}"`);
  }
  return match[1]!;
}

/**
 * Build the normalized canonical payload object from order fields.
 */
export function buildCanonicalPayload(input: CanonicalOrderInput): CanonicalPayload {
  return {
    amount: formatStellarAmount(input.amount),
    asset_code: input.assetCode,
    asset_issuer: input.assetIssuer ?? '',
    due_date: input.dueDate == null ? '' : toDateOnly(input.dueDate),
    external_id: input.externalId ?? '',
    order_id: input.orderId,
    receiver_wallet: input.receiverWallet,
    tenant_id: input.tenantId,
    version: input.version ?? CANONICAL_PAYLOAD_VERSION,
  };
}

/**
 * Recursively serialize a JSON value with object keys sorted lexicographically and no
 * insignificant whitespace. Arrays preserve order. Rejects non-finite numbers and
 * `undefined`/functions (which `JSON.stringify` would drop, breaking determinism).
 */
export function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}

/**
 * Canonical JSON string for a set of order fields (deterministic, sorted, compact).
 */
export function canonicalize(input: CanonicalOrderInput): string {
  return stableStringify(buildCanonicalPayload(input));
}

/**
 * Canonical bytes (UTF-8) for hashing.
 */
export function canonicalBytes(input: CanonicalOrderInput): Uint8Array {
  return new TextEncoder().encode(canonicalize(input));
}
