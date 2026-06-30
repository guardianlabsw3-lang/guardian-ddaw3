import { isTerminal } from '../../domain/payment-order/index.js';
import type {
  Clock,
  Logger,
  PaymentOrderRepository,
  RegisterOrderJob,
  SorobanContractPort,
} from '../ports/index.js';

/**
 * TASK-016 — register a `CREATED` order on-chain and transition it to `ACTIVE`.
 *
 * This is the application core of the registration worker: framework-free and driven by an
 * injected `SorobanContractPort`, so it is fully unit-testable with a mocked adapter. The
 * queue (BullMQ) provides at-least-once delivery and retries; this use case provides the
 * **idempotency** that makes those retries safe:
 *
 * - missing order            → non-retryable, reported as `missing`;
 * - already `ACTIVE`         → no-op, reported as `already-active`;
 * - terminal (PAID/…)        → no-op, reported as `skipped`;
 * - `CREATED`                → `register_order`, then `markRegisteredOnChain` → `ACTIVE`.
 *
 * Transient adapter failures are rethrown so the queue can retry. A permanently failed
 * registration is moved to `FAILED` via {@link RegisterOrderOnChain.markFailed}, called by
 * the worker once retries are exhausted.
 */
export type RegisterOutcome = 'registered' | 'already-active' | 'skipped' | 'missing';

export interface RegisterOrderOutcome {
  outcome: RegisterOutcome;
  contractId?: string;
  txHash?: string;
}

export interface RegisterOrderOnChainDeps {
  orders: PaymentOrderRepository;
  contract: SorobanContractPort;
  clock: Clock;
  logger: Logger;
}

export class RegisterOrderOnChain {
  constructor(private readonly deps: RegisterOrderOnChainDeps) {}

  async execute(job: RegisterOrderJob): Promise<RegisterOrderOutcome> {
    const { orders, contract, clock, logger } = this.deps;
    const log = { paymentOrderId: job.paymentOrderId, correlationId: job.correlationId ?? null };

    const order = await orders.findById(job.paymentOrderId);
    if (!order) {
      logger.error('register-order: order not found', log);
      return { outcome: 'missing' };
    }
    if (order.status === 'ACTIVE') {
      logger.debug('register-order: already active', {
        ...log,
        contractId: order.sorobanContractId,
      });
      return { outcome: 'already-active', contractId: order.sorobanContractId ?? undefined };
    }
    if (isTerminal(order.status)) {
      logger.warn('register-order: order in terminal state, skipping', {
        ...log,
        status: order.status,
      });
      return { outcome: 'skipped' };
    }

    // status === 'CREATED' — register on-chain. Adapter errors propagate for queue retry.
    const result = await contract.registerOrder({
      orderId: order.id,
      tenantId: order.tenantId,
      canonicalPayloadHash: order.canonicalPayloadHash,
      receiverWallet: order.receiverWallet,
      amount: order.amount,
      asset: order.asset,
      dueDate: order.dueDate,
      correlationId: job.correlationId ?? order.correlationId,
    });

    // A duplicate-recovery (idempotent) registration carries no tx hash — store null, not "".
    const txHash = result.txHash === '' ? null : result.txHash;
    order.markRegisteredOnChain(result.contractId, txHash, clock.now());
    await orders.save(order);

    logger.info('register-order: registered on-chain', {
      ...log,
      contractId: result.contractId,
      txHash: result.txHash,
      alreadyRegistered: result.alreadyRegistered,
    });
    return { outcome: 'registered', contractId: result.contractId, txHash: result.txHash };
  }

  /**
   * Mark a still-`CREATED` order as `FAILED` after on-chain registration has permanently
   * failed (retries exhausted). No-op if the order has since advanced or is gone.
   */
  async markFailed(paymentOrderId: string, reason: string): Promise<void> {
    const { orders, clock, logger } = this.deps;
    const order = await orders.findById(paymentOrderId);
    if (!order || order.status !== 'CREATED') {
      return;
    }
    order.markFailed(reason, clock.now());
    await orders.save(order);
    logger.error('register-order: marked FAILED after exhausted retries', {
      paymentOrderId,
      reason,
    });
  }
}
