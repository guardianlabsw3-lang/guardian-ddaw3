import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AssetInput } from './scval';
import { buildPayTransaction } from './payment';
import { signXdr } from './freighter';
import { NETWORK_PASSPHRASE } from './network';

/**
 * Orchestrates a non-custodial contract `pay`: build → simulate/prepare → Freighter sign →
 * submit via Soroban RPC → poll for confirmation. Browser-only (network + wallet), so it is
 * not unit-tested; the pure building blocks (`buildPayTransaction`, `scval`) are.
 */
export interface PayParams {
  rpcUrl: string;
  contractId: string;
  payer: string;
  orderRefHex: string;
  amount: string;
  asset: AssetInput;
}

export interface PayResult {
  txHash: string;
}

const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function payOrder(params: PayParams): Promise<PayResult> {
  const server = new rpc.Server(params.rpcUrl, {
    allowHttp: params.rpcUrl.startsWith('http://'),
  });

  const account = await server.getAccount(params.payer);
  const tx = buildPayTransaction({
    contractId: params.contractId,
    payer: params.payer,
    sequence: account.sequenceNumber(),
    orderRefHex: params.orderRefHex,
    amount: params.amount,
    asset: params.asset,
  });

  // Simulate + assemble the Soroban footprint/auth; throws on a contract error (e.g. the
  // order is not ACTIVE, amount/asset mismatch, or expired — spec 07 §8).
  const prepared = await server.prepareTransaction(tx);

  const signedXdr = await signXdr(prepared.toXDR(), NETWORK_PASSPHRASE);
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  const sent = await server.sendTransaction(signedTx);
  if (sent.status === 'ERROR') {
    throw new Error('A rede rejeitou a transação de pagamento.');
  }

  const start = Date.now();
  let result = await server.getTransaction(sent.hash);
  while (
    result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() - start < POLL_TIMEOUT_MS
  ) {
    await delay(POLL_INTERVAL_MS);
    result = await server.getTransaction(sent.hash);
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Pagamento não confirmado (status: ${result.status}).`);
  }

  return { txHash: sent.hash };
}
