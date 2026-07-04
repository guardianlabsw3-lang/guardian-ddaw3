import type { StellarAccount } from '@payorder/shared';

/**
 * `StellarAccountVerifier` — verifies that a destination wallet actually exists (is a funded
 * account) on the Stellar network. A valid StrKey is only a *format* guarantee; a tenant must
 * never register or activate against an account that does not exist on-chain, or its orders
 * would resolve to an unreachable receiver (RN-01/RN-02).
 *
 * Implemented by `HorizonAccountVerifier` (infrastructure/stellar) over Horizon's
 * `GET /accounts/:id`. Use cases depend only on this port so they stay testable with a stub.
 */
export interface StellarAccountVerifier {
  /**
   * Resolve `true` when the account exists on-chain, `false` when Horizon reports it missing
   * (404). Throws when existence cannot be determined (network/transport failure), so callers
   * never treat an unreachable network as "does not exist".
   */
  exists(account: StellarAccount): Promise<boolean>;
}
