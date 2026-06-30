import type { ExpireOrders, Logger } from '@payorder/api';

/**
 * TASK-017 — periodic expiration sweep. Delegates to {@link ExpireOrders}, which transitions
 * `ACTIVE` orders past their due date to `EXPIRED` (UC-09) using the injected clock. Scheduled
 * by the maintenance queue (see `index.ts`).
 */
export interface ExpireOrdersSweepDeps {
  expire: ExpireOrders;
  logger: Logger;
}

export async function expireOrdersSweep(deps: ExpireOrdersSweepDeps): Promise<void> {
  const result = await deps.expire.execute();
  deps.logger.debug('expire-orders: sweep complete', { ...result });
}
