import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type {
  CreateWebhookDeliveryInput,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookDeliveryStatus,
} from '../../application/ports/index.js';
import type { Database } from '../persistence/db.js';
import { webhookDeliveries } from '../persistence/schema/webhooks.js';

/** Drizzle-backed `WebhookDeliveryRepository` over `webhook_deliveries` (spec 09 §6). */
export class DrizzleWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateWebhookDeliveryInput): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({
        paymentOrderId: input.paymentOrderId,
        eventType: input.eventType,
        targetUrl: input.targetUrl,
        attempt: input.attempt,
        status: input.status,
        requestSignature: input.requestSignature ?? null,
        responseStatus: input.responseStatus ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
      })
      .returning();
    return toRecord(row!);
  }

  async findDue(now: Date, limit: number): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.status, ['pending', 'failed']),
          isNotNull(webhookDeliveries.nextRetryAt),
          lte(webhookDeliveries.nextRetryAt, now),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextRetryAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  async update(
    id: string,
    patch: {
      attempt: number;
      status: WebhookDeliveryStatus;
      responseStatus?: number | null;
      requestSignature?: string | null;
      nextRetryAt?: Date | null;
    },
  ): Promise<void> {
    await this.db
      .update(webhookDeliveries)
      .set({
        attempt: patch.attempt,
        status: patch.status,
        responseStatus: patch.responseStatus ?? null,
        requestSignature: patch.requestSignature ?? null,
        nextRetryAt: patch.nextRetryAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, id));
  }

  async listByOrder(paymentOrderId: string): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.paymentOrderId, paymentOrderId))
      .orderBy(asc(webhookDeliveries.createdAt));
    return rows.map(toRecord);
  }
}

function toRecord(row: typeof webhookDeliveries.$inferSelect): WebhookDeliveryRecord {
  return {
    id: row.id,
    paymentOrderId: row.paymentOrderId,
    eventType: row.eventType,
    targetUrl: row.targetUrl,
    attempt: row.attempt,
    status: row.status as WebhookDeliveryStatus,
    requestSignature: row.requestSignature,
    responseStatus: row.responseStatus,
    nextRetryAt: row.nextRetryAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
