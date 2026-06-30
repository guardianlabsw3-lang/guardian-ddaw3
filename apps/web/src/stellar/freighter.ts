import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import { STELLAR_NETWORK } from './network';

/**
 * Thin wrapper over the Freighter browser wallet (`@stellar/freighter-api`). Non-custodial:
 * the payer's seed never leaves the extension — we only ever receive a public key and a
 * **signed** transaction XDR. Browser-only (the underlying API talks to a content script),
 * so it is imported solely by client components.
 */

export class WalletError extends Error {}

/** Whether the Freighter extension is installed and available in this browser. */
export async function isWalletAvailable(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result.isConnected;
  } catch {
    return false;
  }
}

export interface ConnectedWallet {
  address: string;
  network: string;
}

/** Prompt the user to connect and assert they are on Testnet. Returns the payer address. */
export async function connectWallet(): Promise<ConnectedWallet> {
  const access = await requestAccess();
  if (access.error) {
    throw new WalletError(access.error);
  }
  if (!access.address) {
    throw new WalletError('Nenhuma conta foi autorizada na carteira.');
  }

  const net = await getNetwork();
  if (net.error) {
    throw new WalletError(net.error);
  }
  if (net.network !== STELLAR_NETWORK) {
    throw new WalletError(
      `A carteira está na rede "${net.network}". Troque para ${STELLAR_NETWORK} para pagar.`,
    );
  }

  return { address: access.address, network: net.network };
}

/** Read the currently authorized address without prompting (empty string if none). */
export async function getConnectedAddress(): Promise<string> {
  try {
    const result = await getAddress();
    return result.error ? '' : result.address;
  } catch {
    return '';
  }
}

/** Ask Freighter to sign a transaction XDR; returns the signed XDR. */
export async function signXdr(xdr: string, networkPassphrase: string): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });
  if (result.error) {
    throw new WalletError(typeof result.error === 'string' ? result.error : 'Assinatura recusada.');
  }
  return result.signedTxXdr;
}
