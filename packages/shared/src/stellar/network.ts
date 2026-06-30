import { z } from 'zod';

/**
 * Supported Stellar networks. The MVP operates **exclusively on Testnet**
 * (invariant #1 in the product spec) — any other value is rejected.
 */
export const STELLAR_NETWORKS = ['TESTNET'] as const;

export const StellarNetworkSchema = z.enum(STELLAR_NETWORKS, {
  errorMap: () => ({ message: 'UNSUPPORTED_NETWORK' }),
});

export type StellarNetwork = z.infer<typeof StellarNetworkSchema>;

/** The only network accepted by the MVP. */
export const TESTNET: StellarNetwork = 'TESTNET';

export function isSupportedNetwork(network: unknown): network is StellarNetwork {
  return StellarNetworkSchema.safeParse(network).success;
}
