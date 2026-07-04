import type { StellarAccount } from '@payorder/shared';
import type { Logger, StellarAccountVerifier } from '../../application/ports/index.js';

/**
 * `HorizonAccountVerifier` — concrete `StellarAccountVerifier` over Horizon's
 * `GET /accounts/:id`. A `200` means the account exists (is funded) on-chain; a `404` means it
 * does not. Any other outcome (transport error, 5xx, timeout) is non-conclusive and rethrown,
 * so an unreachable Horizon can never be mistaken for "account does not exist".
 *
 * Kept dependency-light (native `fetch`, mirroring the readiness checks) rather than routing
 * through `@stellar/stellar-sdk`'s Horizon client, which throws typed errors we would only
 * unwrap back into this same boolean.
 */
export interface HorizonAccountVerifierConfig {
  /** Horizon base URL, e.g. `https://horizon-testnet.stellar.org`. */
  horizonUrl: string;
  /** Per-request timeout; a slow Horizon should not hang wallet registration. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

export class HorizonAccountVerifier implements StellarAccountVerifier {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(
    config: HorizonAccountVerifierConfig,
    private readonly logger: Logger,
  ) {
    // Normalize once so we can safely append `/accounts/:id`.
    this.base = config.horizonUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async exists(account: StellarAccount): Promise<boolean> {
    const url = `${this.base}/accounts/${encodeURIComponent(account.publicKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 404) {
        return false;
      }
      if (response.ok) {
        return true;
      }
      throw new Error(`horizon: unexpected status ${response.status} verifying account`);
    } catch (error) {
      this.logger.warn('horizon: account existence check failed', {
        publicKey: account.publicKey,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
