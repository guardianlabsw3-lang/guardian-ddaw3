import { z } from 'zod';
import type { Logger } from '../ports/index.js';
import { validate } from '../shared/errors.js';
import { ApplicationError } from '../shared/errors.js';
import { DomainError } from '../../domain/shared/errors.js';
import type { CreatePaymentOrder, CreatePaymentOrderOptions } from './create-payment-order.js';
import type { PaymentOrderView } from './views.js';

/**
 * Batch size ceiling (feature "batch-payment-orders"). Deliberately lower than the read-path
 * pagination ceiling (`maxLimit = 200`, `interfaces/http/query.ts`) because each item runs a
 * full `CreatePaymentOrder.execute()` — several DB round trips plus one queue enqueue — not a
 * single read query. It also sits comfortably under the default rate limit (120/min) so a
 * max-size batch doesn't immediately exhaust the caller's own budget (see `rate-limit.ts`,
 * which imports this constant to weight the limiter by item count).
 */
export const MAX_BATCH_SIZE = 100;

/** Bounds simultaneous DB/queue work per batch regardless of its size. */
export const BATCH_CONCURRENCY = 10;

export const CreatePaymentOrderBatchInputSchema = z.object({
  orders: z
    .array(z.unknown())
    .min(1, { message: 'BATCH_EMPTY' })
    .max(MAX_BATCH_SIZE, { message: 'BATCH_TOO_LARGE' }),
});

export type CreatePaymentOrderBatchInput = z.infer<typeof CreatePaymentOrderBatchInputSchema>;

export interface BatchItemError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export type BatchItemResult =
  | { index: number; ok: true; order: PaymentOrderView }
  | { index: number; ok: false; error: BatchItemError };

export interface CreatePaymentOrderBatchResult {
  summary: { total: number; created: number; failed: number };
  results: BatchItemResult[];
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight at once, writing each result to
 * its own index so the returned array preserves input order regardless of completion order.
 * Exported for direct unit testing (no external dependency exists in this repo for this — a
 * small worker-pool is simpler than adding one just for a 100-item cap).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Best-effort key for `CreatePaymentOrder`'s natural (tenant reference, external_id) dedup,
 * read straight off the still-`unknown` raw item (already DTO-mapped to camelCase by the
 * controller) — the same fields the use case itself resolves the tenant/dedup from. `null`
 * when there's no `externalId` (nothing to dedup on; mirrors the use case's own `if
 * (input.externalId)` guard) or the item isn't an object (malformed items fall through to
 * `CreatePaymentOrder.execute()`'s own validation instead of being silently keyed together).
 */
function dedupeKey(rawItem: unknown): string | null {
  if (rawItem === null || typeof rawItem !== 'object') {
    return null;
  }
  const item = rawItem as Record<string, unknown>;
  const externalId = item.externalId;
  if (typeof externalId !== 'string' || externalId.length === 0) {
    return null;
  }
  const tenantRef = item.tenantId ?? item.slug ?? item.tenantDocument ?? null;
  return JSON.stringify([tenantRef, externalId]);
}

/**
 * Batch creation (feature "batch-payment-orders"). Wraps the existing `CreatePaymentOrder`
 * unchanged, looping it per item so every validation rule, idempotency check and domain
 * invariant is reused verbatim — no duplicated business logic. One bad item never aborts the
 * others: each is caught independently and reported in `results`, preserving input order.
 */
export class CreatePaymentOrderBatch {
  constructor(
    private readonly createOrder: CreatePaymentOrder,
    private readonly logger: Logger,
  ) {}

  async execute(
    rawInput: unknown,
    options: CreatePaymentOrderOptions = {},
  ): Promise<CreatePaymentOrderBatchResult> {
    const { orders } = validate(CreatePaymentOrderBatchInputSchema, rawInput);

    // CreatePaymentOrder's natural (tenant, external_id) dedup is a check-then-act read+save —
    // safe for one request at a time, but two items in the *same* batch sharing a reference
    // would otherwise both see "not found" when run concurrently and create duplicate orders.
    // Chain same-key items to run strictly in submitted order (a prior failure never blocks a
    // later duplicate); unrelated items still run with full `BATCH_CONCURRENCY`.
    const chains = new Map<string, Promise<unknown>>();

    const results = await mapWithConcurrency(orders, BATCH_CONCURRENCY, async (item, index) => {
      const key = dedupeKey(item);
      const previous = key ? chains.get(key) : undefined;
      const run = (async () => {
        if (previous) {
          await previous.catch(() => {});
        }
        try {
          const order = await this.createOrder.execute(item, options);
          return { index, ok: true, order } as const;
        } catch (err) {
          return { index, ok: false, error: this.toItemError(err, index, options) } as const;
        }
      })();
      if (key) {
        chains.set(key, run);
      }
      return run;
    });

    const created = results.filter((r) => r.ok).length;
    return {
      summary: { total: results.length, created, failed: results.length - created },
      results,
    };
  }

  /**
   * Shape a per-item failure the same way `toErrorResponse` shapes the HTTP envelope (spec 08
   * §1), minus `request_id` (that belongs to the whole request, not one item). A truly
   * unexpected error is logged with full detail server-side and never leaked to the client —
   * same posture as the existing 500 path — but, unlike that path, isolated to this one item
   * so the rest of the batch still completes.
   */
  private toItemError(
    err: unknown,
    index: number,
    options: CreatePaymentOrderOptions,
  ): BatchItemError {
    if (err instanceof ApplicationError || err instanceof DomainError) {
      return { code: err.code, message: err.message, details: err.details ?? {} };
    }
    this.logger.error('unhandled error in batch item', {
      index,
      correlationId: options.correlationId ?? null,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: {} };
  }
}
