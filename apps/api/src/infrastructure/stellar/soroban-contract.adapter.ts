import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  type xdr,
} from '@stellar/stellar-sdk';
import { deriveOrderRef, deriveTenantRef } from '@payorder/shared';
import type {
  Logger,
  OnChainOrder,
  OnChainOrderStatus,
  RegisterOrderParams,
  RegisterOrderResult,
  SorobanContractPort,
} from '../../application/ports/index.js';
import {
  addressToScVal,
  assetToScVal,
  hex32ToScVal,
  refToScVal,
  resolveSacAddress,
  toStroops,
} from './scval.js';

/**
 * `SorobanContractAdapter` (TASK-016, spec 04 §5 / 07 §9) — the concrete
 * `SorobanContractPort` over Soroban RPC and `@stellar/stellar-sdk`.
 *
 * - `registerOrder` builds, simulates (`prepareTransaction`), signs with the **admin** key
 *   and submits `register_order`, polling for confirmation. It is idempotent: if the order is
 *   already registered (the contract rejects a duplicate), it reports `alreadyRegistered`
 *   instead of failing.
 * - `getOrder` invokes the read-only `get_order` via simulation (no fees, no signature) and
 *   decodes the on-chain `PaymentOrder` into the subset the worker reconciles.
 *
 * Network is asserted Testnet-only at the config boundary (`STELLAR_NETWORK_PASSPHRASE`).
 */
export interface SorobanContractAdapterConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /** Admin secret seed (`S...`) authorizing `register_order`. */
  adminSecret: string;
  /** Allow plaintext RPC (local only). */
  allowHttp?: boolean;
  /** Confirmation polling: attempts and delay between them. */
  pollAttempts?: number;
  pollIntervalMs?: number;
}

const SECONDS_PER_LEDGER = 5;
const U32_MAX = 0xffff_ffff;
const DEFAULT_POLL_ATTEMPTS = 30;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export class SorobanContractAdapter implements SorobanContractPort {
  readonly contractId: string;
  private readonly server: rpc.Server;
  private readonly admin: Keypair;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;
  private readonly pollAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(
    config: SorobanContractAdapterConfig,
    private readonly logger: Logger,
  ) {
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: config.allowHttp ?? false });
    this.admin = Keypair.fromSecret(config.adminSecret);
    this.contract = new Contract(config.contractId);
    this.pollAttempts = config.pollAttempts ?? DEFAULT_POLL_ATTEMPTS;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult> {
    const dueLedger = await this.computeDueLedger(params.dueDate ?? null);
    const token = resolveSacAddress(params.asset, this.networkPassphrase);

    const operation = this.contract.call(
      'register_order',
      refToScVal(deriveOrderRef(params.orderId)),
      hex32ToScVal(params.canonicalPayloadHash),
      refToScVal(deriveTenantRef(params.tenantId)),
      addressToScVal(params.receiverWallet),
      addressToScVal(token),
      nativeToScVal(toStroops(params.amount), { type: 'i128' }),
      assetToScVal(params.asset),
      nativeToScVal(dueLedger, { type: 'u32' }),
    );

    try {
      const txHash = await this.invokeSigned(operation);
      return { contractId: this.contractId, txHash, alreadyRegistered: false };
    } catch (error) {
      // Idempotency: if the order already exists on-chain, treat the duplicate as success.
      // Any failure of this probe is non-conclusive, so the original error is rethrown.
      const existing = await this.getOrder(params.orderId).catch(() => null);
      if (existing) {
        this.logger.warn('soroban: register_order duplicate, order already on-chain', {
          orderId: params.orderId,
          status: existing.status,
        });
        return { contractId: this.contractId, txHash: '', alreadyRegistered: true };
      }
      throw error;
    }
  }

  async getOrder(orderId: string): Promise<OnChainOrder | null> {
    const operation = this.contract.call('get_order', refToScVal(deriveOrderRef(orderId)));
    const tx = new TransactionBuilder(this.readSource(), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      // A missing order makes the contract return `OrderNotFound`, surfacing as a sim error.
      return null;
    }
    return this.decodeOrder(sim.result.retval);
  }

  /** Build, prepare (simulate), sign with admin, submit and await confirmation. Returns hash. */
  private async invokeSigned(operation: xdr.Operation): Promise<string> {
    const source = await this.server.getAccount(this.admin.publicKey());
    const built = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(built);
    prepared.sign(this.admin);

    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new Error(`soroban: sendTransaction failed (${sent.hash})`);
    }
    return this.awaitConfirmation(sent.hash);
  }

  private async awaitConfirmation(hash: string): Promise<string> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const result = await this.server.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return hash;
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`soroban: transaction ${hash} failed on-chain`);
      }
      await delay(this.pollIntervalMs);
    }
    throw new Error(`soroban: transaction ${hash} not confirmed after ${this.pollAttempts} polls`);
  }

  /** Lightweight source account for read-only simulation (sequence is irrelevant). */
  private readSource(): Account {
    return new Account(this.admin.publicKey(), '0');
  }

  /** Map a due date to a `due_ledger` (0 = no expiry) using the current ledger sequence. */
  private async computeDueLedger(dueDate: string | null): Promise<number> {
    if (!dueDate) {
      return 0;
    }
    const latest = await this.server.getLatestLedger();
    const targetMs = Date.parse(`${dueDate}T23:59:59Z`);
    if (Number.isNaN(targetMs)) {
      return 0;
    }
    const secondsRemaining = Math.floor((targetMs - Date.now()) / 1000);
    const ledgersRemaining = Math.ceil(secondsRemaining / SECONDS_PER_LEDGER);
    const dueLedger = latest.sequence + ledgersRemaining;
    // Keep within u32 and strictly positive; a past date yields a low (already-expired) ledger.
    return Math.min(Math.max(dueLedger, 1), U32_MAX);
  }

  /** Decode the contract's `PaymentOrder` ScVal into the reconciliation subset. */
  private decodeOrder(retval: xdr.ScVal): OnChainOrder | null {
    const raw = scValToNative(retval) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return {
      status: normalizeStatus(raw.status),
      payer: typeof raw.paid_by === 'string' ? raw.paid_by : null,
      paidAt: toDate(raw.paid_at),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Unit enum variants decode as `["Active"]`/`"Active"`; normalize to the off-chain code. */
function normalizeStatus(value: unknown): OnChainOrderStatus {
  const name = Array.isArray(value) ? value[0] : value;
  switch (name) {
    case 'Active':
      return 'ACTIVE';
    case 'Paid':
      return 'PAID';
    case 'Expired':
      return 'EXPIRED';
    case 'Cancelled':
      return 'CANCELLED';
    case 'Failed':
      return 'FAILED';
    default:
      throw new Error(`soroban: unknown on-chain OrderStatus: ${String(name)}`);
  }
}

/** Soroban `u64` timestamps decode as `bigint` (seconds since epoch). */
function toDate(value: unknown): Date | null {
  if (typeof value === 'bigint') {
    return new Date(Number(value) * 1000);
  }
  if (typeof value === 'number') {
    return new Date(value * 1000);
  }
  return null;
}
