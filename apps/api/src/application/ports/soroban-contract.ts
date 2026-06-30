import type { Asset } from '@payorder/shared';

/**
 * `SorobanContractPort` (spec 04 §5, 07 §9) — the stable interface the application uses to
 * drive the on-chain PayOrder contract, decoupled from the Soroban RPC SDK. The
 * `SorobanContractAdapter` (infrastructure/stellar) implements it; use cases and the worker
 * depend only on this port so they stay testable with a mock.
 *
 * Off-chain UUIDs are folded into the contract's `BytesN<32>` references by the adapter
 * (via `@payorder/shared` `deriveOrderRef`/`deriveTenantRef`), so callers pass plain UUIDs.
 */

/** On-chain lifecycle states (spec 07 §6). `Created` is off-chain only and never appears. */
export type OnChainOrderStatus = 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

/** A read of the order as it exists on-chain (subset relevant to off-chain reconciliation). */
export interface OnChainOrder {
  status: OnChainOrderStatus;
  /** Payer account (`G...`) once paid, else null. */
  payer: string | null;
  /** Ledger close time of the payment, else null. */
  paidAt: Date | null;
}

export interface RegisterOrderParams {
  /** Off-chain order UUID; folded into the on-chain `order_id` (`BytesN<32>`). */
  orderId: string;
  /** Off-chain tenant UUID; folded into the on-chain `tenant_ref` (`BytesN<32>`). */
  tenantId: string;
  /** SHA-256 canonical-payload hash (64 hex) stored on-chain as `data_hash`. */
  canonicalPayloadHash: string;
  /** Receiving tenant wallet (`G...`). */
  receiverWallet: string;
  /** Decimal amount string (7-scale), e.g. `"150.0000000"`. */
  amount: string;
  asset: Asset;
  /** Optional ISO date-only expiry; mapped to the contract's `due_ledger` (0 = no expiry). */
  dueDate?: string | null;
  correlationId?: string | null;
}

export interface RegisterOrderResult {
  /** The contract id the order was registered on (`C...`). */
  contractId: string;
  /** Hash of the on-chain registration transaction. */
  txHash: string;
  /** True when the order was already registered (idempotent re-run). */
  alreadyRegistered: boolean;
}

export interface SorobanContractPort {
  /** Contract id this adapter is bound to (`C...`). */
  readonly contractId: string;
  /**
   * Register an order on-chain (`register_order`), transitioning it to `ACTIVE`. Must be
   * idempotent: a repeat for an already-registered `orderId` resolves successfully with
   * `alreadyRegistered: true` instead of failing.
   */
  registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult>;
  /** Read an order on-chain (`get_order`). Returns null when it does not exist. */
  getOrder(orderId: string): Promise<OnChainOrder | null>;
}
