/**
 * Stellar uses a fixed scale of 7 decimal places. To keep the canonical payload (and
 * therefore the order hash) deterministic, amounts are always serialized as a decimal
 * string with **exactly 7 fractional digits** — e.g. `"150"` → `"150.0000000"`.
 *
 * Float is never used: parsing is string-based to avoid precision loss.
 */

export const STELLAR_AMOUNT_SCALE = 7;

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Normalize a non-negative decimal amount to a fixed 7-decimal string.
 *
 * @throws {RangeError} if the value is not a valid non-negative decimal, or has more
 *   than 7 fractional digits (truncating silently would change the hash).
 */
export function formatStellarAmount(value: string | number): string {
  const raw = typeof value === 'number' ? numberToDecimalString(value) : value.trim();

  const match = AMOUNT_PATTERN.exec(raw);
  if (!match) {
    throw new RangeError(`Invalid amount: "${raw}"`);
  }

  const integerPart = match[1]!.replace(/^0+(?=\d)/, ''); // strip leading zeros, keep one
  const fractionPart = match[2] ?? '';

  if (fractionPart.length > STELLAR_AMOUNT_SCALE) {
    throw new RangeError(
      `Amount "${raw}" exceeds ${STELLAR_AMOUNT_SCALE} decimal places of precision`,
    );
  }

  const fraction = fractionPart.padEnd(STELLAR_AMOUNT_SCALE, '0');
  return `${integerPart}.${fraction}`;
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Invalid amount: ${value}`);
  }
  // Avoid scientific notation for small/large finite numbers.
  return value.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: STELLAR_AMOUNT_SCALE,
  });
}
