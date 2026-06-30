import {
  canonicalPayloadHash,
  isValidStellarPublicKey,
  type Asset,
  type StellarPublicKey,
  type Slug,
} from '@payorder/shared';
import { DomainError, InvalidStateTransitionError } from '../shared/errors.js';
import { Money } from '../shared/money.js';
import { canTransition, type OrderStatus } from './order-status.js';
import { DEFAULT_ORDER_SOURCE, type OrderSource } from './order-source.js';
import type { PaymentOrderEvent, PaymentOrderEventType } from './events.js';

/**
 * Aggregate root `PaymentOrder` (spec 03 §2.2). Owns the charge lifecycle and the
 * payment-integrity invariants: the receiver wallet is **copied** from the tenant and is
 * immutable (RN-03), and `amount`/`asset`/`canonicalPayloadHash` are immutable after
 * creation (RN-04). State changes go exclusively through the documented state machine.
 */

export interface PaymentOrderProps {
  id: string;
  tenantId: string;
  externalId: string | null;
  amount: string;
  asset: Asset;
  receiverWallet: StellarPublicKey;
  canonicalPayloadHash: string;
  status: OrderStatus;
  source: OrderSource;
  dueDate: string | null;
  description: string | null;
  publicSlug: Slug;
  sorobanContractId: string | null;
  blockchainTxHash: string | null;
  metadata: Record<string, unknown>;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

export interface CreatePaymentOrderProps {
  id: string;
  tenantId: string;
  amount: string;
  asset: Asset;
  /** Copied from the tenant's wallet — never supplied by the order request (RN-02/RN-03). */
  receiverWallet: StellarPublicKey;
  publicSlug: Slug;
  externalId?: string | null;
  dueDate?: string | null;
  description?: string | null;
  source?: OrderSource;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
  now: Date;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PaymentOrder {
  private readonly _id: string;
  private readonly _tenantId: string;
  private readonly _externalId: string | null;
  private readonly _amount: string;
  private readonly _asset: Asset;
  private readonly _receiverWallet: StellarPublicKey;
  private readonly _canonicalPayloadHash: string;
  private _status: OrderStatus;
  private readonly _source: OrderSource;
  private readonly _dueDate: string | null;
  private readonly _description: string | null;
  private readonly _publicSlug: Slug;
  private _sorobanContractId: string | null;
  private _blockchainTxHash: string | null;
  private readonly _metadata: Record<string, unknown>;
  private _correlationId: string | null;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _paidAt: Date | null;
  private readonly _events: PaymentOrderEvent[] = [];

  private constructor(props: PaymentOrderProps) {
    this._id = props.id;
    this._tenantId = props.tenantId;
    this._externalId = props.externalId;
    this._amount = props.amount;
    this._asset = props.asset;
    this._receiverWallet = props.receiverWallet;
    this._canonicalPayloadHash = props.canonicalPayloadHash;
    this._status = props.status;
    this._source = props.source;
    this._dueDate = props.dueDate;
    this._description = props.description;
    this._publicSlug = props.publicSlug;
    this._sorobanContractId = props.sorobanContractId;
    this._blockchainTxHash = props.blockchainTxHash;
    this._metadata = props.metadata;
    this._correlationId = props.correlationId;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._paidAt = props.paidAt;
  }

  /**
   * Factory (spec 03 §2.2). Validates invariants, fixes the copied receiver wallet,
   * computes the deterministic canonical-payload hash (shared, single source of truth),
   * sets the initial `CREATED` status and emits `PaymentOrderCreated`.
   */
  static create(props: CreatePaymentOrderProps): PaymentOrder {
    if (!isValidStellarPublicKey(props.receiverWallet)) {
      throw new DomainError(
        'INVALID_STELLAR_PUBLIC_KEY',
        'Receiver wallet is not a valid Stellar public key',
      );
    }
    // Validates amount > 0 and scale; the asset shape is validated upstream by zod.
    const money = Money.of(props.amount, props.asset);
    const dueDate = PaymentOrder.normalizeDueDate(props.dueDate);

    const hash = canonicalPayloadHash({
      orderId: props.id,
      tenantId: props.tenantId,
      receiverWallet: props.receiverWallet,
      amount: money.amount,
      assetCode: money.asset.code,
      assetIssuer: money.asset.issuer,
      externalId: props.externalId ?? null,
      dueDate,
    });

    const order = new PaymentOrder({
      id: props.id,
      tenantId: props.tenantId,
      externalId: props.externalId ?? null,
      amount: money.amount,
      asset: money.asset,
      receiverWallet: props.receiverWallet,
      canonicalPayloadHash: hash,
      status: 'CREATED',
      source: props.source ?? DEFAULT_ORDER_SOURCE,
      dueDate,
      description: props.description ?? null,
      publicSlug: props.publicSlug,
      sorobanContractId: null,
      blockchainTxHash: null,
      metadata: props.metadata ?? {},
      correlationId: props.correlationId ?? null,
      createdAt: props.now,
      updatedAt: props.now,
      paidAt: null,
    });

    order.record('created', props.now, {
      orderId: order._id,
      tenantId: order._tenantId,
      amount: order._amount,
      assetCode: order._asset.code,
      canonicalPayloadHash: hash,
    });
    return order;
  }

  /** Rebuild from persistence without emitting creation events. */
  static fromPersistence(props: PaymentOrderProps): PaymentOrder {
    return new PaymentOrder(props);
  }

  private static normalizeDueDate(value: string | null | undefined): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const dateOnly = trimmed.slice(0, 10);
    if (!DATE_ONLY_PATTERN.test(dateOnly) || Number.isNaN(Date.parse(dateOnly))) {
      throw new DomainError('INVALID_DUE_DATE', `Invalid due date: ${value}`, { dueDate: value });
    }
    return dateOnly;
  }

  /** `CREATED → ACTIVE` — on-chain registration confirmed (spec 03 §3). */
  markRegisteredOnChain(contractId: string, txHash: string | null, now: Date): void {
    this.transition('ACTIVE', now);
    this._sorobanContractId = contractId;
    this._blockchainTxHash = txHash;
    this.record('registered', now, {
      orderId: this._id,
      sorobanContractId: contractId,
      blockchainTxHash: txHash,
    });
  }

  /**
   * `ACTIVE → PAID` — valid on-chain payment. Idempotent when already paid (RN-07). The tx
   * hash is nullable because reconciliation via `get_order` confirms the `PAID` state without
   * necessarily carrying the payer's transaction hash.
   */
  markPaid(txHash: string | null, paidAt: Date, now: Date): void {
    if (this._status === 'PAID') {
      return;
    }
    this.transition('PAID', now);
    if (txHash !== null) {
      this._blockchainTxHash = txHash;
    }
    this._paidAt = paidAt;
    this.record('paid', now, {
      orderId: this._id,
      blockchainTxHash: this._blockchainTxHash,
      paidAt,
    });
  }

  /** `ACTIVE → CANCELLED` — authorized cancellation only (RN-08). */
  cancel(by: string, now: Date): void {
    this.transition('CANCELLED', now);
    this.record('cancelled', now, { orderId: this._id, by });
  }

  /** `ACTIVE → EXPIRED` — due date passed (UC-09). */
  expire(now: Date): void {
    this.transition('EXPIRED', now);
    this.record('expired', now, { orderId: this._id });
  }

  /** `CREATED|ACTIVE → FAILED` — irreversible registration/payment failure. */
  markFailed(reason: string, now: Date): void {
    this.transition('FAILED', now);
    this.record('failed', now, { orderId: this._id, reason });
  }

  /**
   * RN-05: guard that the order is payable — `ACTIVE` and not past its due date. The
   * domain throws so application/contract layers fail closed.
   */
  assertPayable(now: Date): void {
    if (this._status !== 'ACTIVE') {
      throw new DomainError('ORDER_NOT_PAYABLE', `Order is not payable in status ${this._status}`, {
        status: this._status,
      });
    }
    if (this.isPastDue(now)) {
      throw new DomainError('ORDER_EXPIRED', 'Order is past its due date', {
        dueDate: this._dueDate,
      });
    }
  }

  /** True when the order has a due date strictly before the current UTC date. */
  isPastDue(now: Date): boolean {
    if (this._dueDate === null) {
      return false;
    }
    return this._dueDate < now.toISOString().slice(0, 10);
  }

  private transition(to: OrderStatus, now: Date): void {
    if (!canTransition(this._status, to)) {
      throw new InvalidStateTransitionError(this._status, to);
    }
    this._status = to;
    this._updatedAt = now;
  }

  private record(type: PaymentOrderEventType, occurredAt: Date, payload: Record<string, unknown>) {
    this._events.push({ type, payload, occurredAt });
  }

  /** Drain and return events accumulated since the last pull. */
  pullEvents(): PaymentOrderEvent[] {
    return this._events.splice(0, this._events.length);
  }

  get id(): string {
    return this._id;
  }
  get tenantId(): string {
    return this._tenantId;
  }
  get externalId(): string | null {
    return this._externalId;
  }
  get amount(): string {
    return this._amount;
  }
  get asset(): Asset {
    return this._asset;
  }
  get receiverWallet(): StellarPublicKey {
    return this._receiverWallet;
  }
  get canonicalPayloadHash(): string {
    return this._canonicalPayloadHash;
  }
  get status(): OrderStatus {
    return this._status;
  }
  get source(): OrderSource {
    return this._source;
  }
  get dueDate(): string | null {
    return this._dueDate;
  }
  get description(): string | null {
    return this._description;
  }
  get publicSlug(): Slug {
    return this._publicSlug;
  }
  get sorobanContractId(): string | null {
    return this._sorobanContractId;
  }
  get blockchainTxHash(): string | null {
    return this._blockchainTxHash;
  }
  get metadata(): Record<string, unknown> {
    return this._metadata;
  }
  get correlationId(): string | null {
    return this._correlationId;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get paidAt(): Date | null {
    return this._paidAt;
  }
}
