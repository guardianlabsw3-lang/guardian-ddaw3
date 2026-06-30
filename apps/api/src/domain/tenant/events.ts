import type { Document } from '@payorder/shared';

/**
 * Tenant domain events (spec 03 §6). They are recorded on the aggregate and pulled by the
 * application layer to feed auditing/webhooks. Unlike payment-order events they are not
 * persisted in a dedicated table in the MVP (they land in `audit_logs`, TASK-023).
 */
export type TenantEvent =
  | { type: 'TenantCreated'; tenantId: string; document: Document; occurredAt: Date }
  | { type: 'TenantWalletAssigned'; tenantId: string; publicKey: string; occurredAt: Date }
  | { type: 'TenantActivated'; tenantId: string; occurredAt: Date }
  | { type: 'TenantDeactivated'; tenantId: string; occurredAt: Date };
