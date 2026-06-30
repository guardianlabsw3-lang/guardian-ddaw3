import type { Logger, PaymentOrderRepository, SyncOrderStatus } from '@payorder/api';

/**
 * TASK-017 — periodic reconciliation sweep. Pages over every `ACTIVE` order and runs
 * {@link SyncOrderStatus}, which reflects on-chain `PAID`/`CANCELLED`/`EXPIRED` off-chain and
 * logs divergences. Idempotent: orders already in sync are untouched. Scheduled by the
 * maintenance queue (see `index.ts`).
 */
export interface SyncStatusSweepDeps {
  orders: PaymentOrderRepository;
  sync: SyncOrderStatus;
  logger: Logger;
  pageSize?: number;
}

export interface SyncStatusSweepResult {
  scanned: number;
  updated: number;
}

const DEFAULT_PAGE_SIZE = 100;

export async function syncStatusSweep(deps: SyncStatusSweepDeps): Promise<SyncStatusSweepResult> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  let scanned = 0;
  let updated = 0;
  let offset = 0;

  for (;;) {
    const page = await deps.orders.list({ status: 'ACTIVE', limit: pageSize, offset });
    if (page.items.length === 0) {
      break;
    }

    let updatedThisPage = 0;
    for (const order of page.items) {
      scanned += 1;
      const result = await deps.sync.execute(order.id);
      if (result.outcome === 'updated') {
        updatedThisPage += 1;
      }
    }
    updated += updatedThisPage;

    // Reconciled rows leave the ACTIVE set; advance only past those still ACTIVE this page.
    offset += page.items.length - updatedThisPage;
    if (page.items.length < pageSize) {
      break;
    }
  }

  if (updated > 0) {
    deps.logger.info('sync-status: sweep applied updates', { scanned, updated });
  }
  return { scanned, updated };
}
