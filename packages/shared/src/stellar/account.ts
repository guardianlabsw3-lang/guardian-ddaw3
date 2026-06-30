import { z } from 'zod';
import { StellarPublicKeySchema } from './public-key.js';
import { StellarNetworkSchema } from './network.js';

/**
 * `StellarAccount` value object: a public key bound to a network. The MVP only ever
 * binds Testnet accounts (see `network.ts`).
 */
export const StellarAccountSchema = z.object({
  publicKey: StellarPublicKeySchema,
  network: StellarNetworkSchema,
});

export type StellarAccount = z.infer<typeof StellarAccountSchema>;

export function toStellarAccount(input: { publicKey: string; network: string }): StellarAccount {
  return StellarAccountSchema.parse(input);
}
