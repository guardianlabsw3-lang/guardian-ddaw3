import { Networks } from '@stellar/stellar-sdk';

/**
 * Stellar Testnet constants and explorer-link builders. The MVP signs and submits only on
 * Testnet (product invariant #1), so the passphrase is fixed.
 */
export const NETWORK_PASSPHRASE: string = Networks.TESTNET;

export const STELLAR_NETWORK = 'TESTNET' as const;

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function contractExplorerUrl(explorerBase: string, contractId: string): string {
  return join(explorerBase, `contract/${contractId}`);
}

export function txExplorerUrl(explorerBase: string, txHash: string): string {
  return join(explorerBase, `tx/${txHash}`);
}

export function accountExplorerUrl(explorerBase: string, account: string): string {
  return join(explorerBase, `account/${account}`);
}
