import { formatStellarAmount, isNativeAsset, type Asset } from '@payorder/shared';
import { DomainError } from './errors.js';

/**
 * `Money` value object — a strictly positive decimal amount (fixed Stellar scale of 7)
 * bound to an `Asset`. Float is never used; the amount is kept as a normalized decimal
 * string so the canonical payload (and therefore the order hash) is deterministic
 * (spec 03 §4/§5).
 */
export class Money {
  private constructor(
    readonly amount: string,
    readonly asset: Asset,
  ) {}

  /**
   * Build a `Money` from a raw amount and asset. The amount must be a valid non-negative
   * decimal with at most 7 fractional digits **and strictly greater than zero** (the
   * `payment_orders.amount > 0` constraint in spec 09 §2).
   *
   * @throws {DomainError} `INVALID_AMOUNT` when the amount is not a valid decimal/scale,
   *   `AMOUNT_MUST_BE_POSITIVE` when it is zero.
   */
  static of(amount: string | number, asset: Asset): Money {
    let normalized: string;
    try {
      normalized = formatStellarAmount(amount);
    } catch (err) {
      throw new DomainError('INVALID_AMOUNT', `Invalid amount: ${String(amount)}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (!Money.isPositive(normalized)) {
      throw new DomainError('AMOUNT_MUST_BE_POSITIVE', 'Amount must be greater than zero', {
        amount: normalized,
      });
    }
    return new Money(normalized, asset);
  }

  /** True when the normalized decimal string represents a value strictly above zero. */
  private static isPositive(normalized: string): boolean {
    return /[1-9]/.test(normalized);
  }

  get assetCode(): string {
    return this.asset.code;
  }

  get assetIssuer(): string | null {
    return this.asset.issuer;
  }

  get isNative(): boolean {
    return isNativeAsset(this.asset);
  }

  equals(other: Money): boolean {
    return (
      this.amount === other.amount &&
      this.asset.code === other.asset.code &&
      this.asset.issuer === other.asset.issuer
    );
  }
}
