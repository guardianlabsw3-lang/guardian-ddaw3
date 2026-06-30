import type { Logger, RetryDueWebhooks } from '@payorder/api';

/**
 * TASK-022 — periodic webhook retry sweep. Delegates to {@link RetryDueWebhooks}, which
 * re-attempts deliveries whose backoff window has elapsed (re-signing and rescheduling via
 * the dispatcher). Scheduled by the maintenance queue (see `index.ts`).
 */
export interface DeliverWebhookSweepDeps {
  retryWebhooks: RetryDueWebhooks;
  logger: Logger;
}

export async function deliverWebhookSweep(deps: DeliverWebhookSweepDeps): Promise<void> {
  const result = await deps.retryWebhooks.execute();
  deps.logger.debug('deliver-webhook: sweep complete', { ...result });
}
