import { isTerminal } from '../../domain/payment-order/index.js';
import type {
  Clock,
  Logger,
  OnChainOrder,
  PaymentOrderRepository,
  SorobanContractPort,
} from '../ports/index.js';

/**
 * TASK-017 — reconcile a single order's off-chain state with the on-chain authority.
 *
 * The contract is the source of truth for the payment status (spec 07). This use case reads
 * `get_order` and reflects `PAID`/`CANCELLED`/`EXPIRED` off-chain, idempotently. Divergences
 * that can't be auto-applied (e.g. the order is missing on-chain, or the two sides disagree
 * irreconcilably) are **logged** rather than forced, so an operator can investigate.
 *
 * Pure and `Clock`-injectable; tested against a mock `SorobanContractPort`.
 */
export type SyncOutcome =
  'updated' | 'in-sync' | 'not-registered' | 'missing-on-chain' | 'divergent' | 'missing';

export interface SyncOrderResult {
  outcome: SyncOutcome;
  onChainStatus?: OnChainOrder['status'];
}

export interface SyncOrderStatusDeps {
  orders: PaymentOrderRepository;
  contract: SorobanContractPort;
  clock: Clock;
  logger: Logger;
}

export class SyncOrderStatus {
  constructor(private readonly deps: SyncOrderStatusDeps) {}

  async execute(paymentOrderId: string): Promise<SyncOrderResult> {
    const { orders, contract, clock, logger } = this.deps;
    const order = await orders.findById(paymentOrderId);
    if (!order) {
      logger.warn('sync-status: order not found', { paymentOrderId });
      return { outcome: 'missing' };
    }

    const log = {
      paymentOrderId,
      offChainStatus: order.status,
      correlationId: order.correlationId,
    };

    // Off-chain not yet registered: registration worker owns the CREATED→ACTIVE transition.
    if (order.status === 'CREATED') {
      return { outcome: 'not-registered' };
    }
    // Already in a terminal state off-chain: nothing left to reconcile.
    if (isTerminal(order.status)) {
      return { outcome: 'in-sync', onChainStatus: order.status };
    }

    const onChain = await contract.getOrder(paymentOrderId);
    if (!onChain) {
      logger.warn('sync-status: order ACTIVE off-chain but absent on-chain', log);
      return { outcome: 'missing-on-chain' };
    }

    const now = clock.now();
    switch (onChain.status) {
      case 'ACTIVE':
        return { outcome: 'in-sync', onChainStatus: 'ACTIVE' };
      case 'PAID':
        order.markPaid(null, onChain.paidAt ?? now, now);
        break;
      case 'CANCELLED':
        order.cancel('on-chain', now);
        break;
      case 'EXPIRED':
        order.expire(now);
        break;
      case 'FAILED':
        order.markFailed('on-chain failure', now);
        break;
      default: {
        // Unknown on-chain status — log the divergence and leave the order untouched.
        const exhaustive: never = onChain.status;
        logger.error('sync-status: unknown on-chain status', { ...log, onChainStatus: exhaustive });
        return { outcome: 'divergent' };
      }
    }

    await orders.save(order);
    logger.info('sync-status: applied on-chain status', { ...log, onChainStatus: onChain.status });
    return { outcome: 'updated', onChainStatus: onChain.status };
  }
}
