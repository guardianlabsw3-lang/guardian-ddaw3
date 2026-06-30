import { Account, BASE_FEE, Contract, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { payArgs, type AssetInput } from './scval';
import { NETWORK_PASSPHRASE } from './network';

/**
 * Builds the unsigned Stellar transaction that invokes the contract's `pay` method, moving
 * funds **payer → tenant wallet** entirely from the client (non-custodial — the payer's seed
 * never leaves their wallet). Pure and synchronous so it is unit-tested without network or
 * wallet; simulation, signing (Freighter) and submission are handled by the caller.
 */
export interface BuildPayTransactionParams {
  contractId: string;
  /** Payer account public key (`G...`) — the transaction source and the `payer` arg. */
  payer: string;
  /** Latest sequence number for the payer account (from Horizon/RPC). */
  sequence: string;
  /** On-chain order reference (64-char hex), derived from the off-chain order id. */
  orderRefHex: string;
  amount: string;
  asset: AssetInput;
  /** Override the network passphrase (defaults to Testnet). */
  networkPassphrase?: string;
  /** Transaction timeout in seconds. */
  timeoutSeconds?: number;
}

export function buildPayTransaction(params: BuildPayTransactionParams): Transaction {
  const source = new Account(params.payer, params.sequence);
  const contract = new Contract(params.contractId);
  const operation = contract.call(
    'pay',
    ...payArgs(params.orderRefHex, params.payer, params.amount, params.asset),
  );

  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase ?? NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(params.timeoutSeconds ?? 300)
    .build();
}
