import type {
  CancelPaymentOrder,
  CreatePaymentOrder,
  GetPaymentOrder,
  GetPaymentOrderEvents,
  GetPaymentOrderStatus,
  ListPaymentOrders,
} from '../../../application/payment-order/index.js';
import type { AuditLogger } from '../../../application/ports/index.js';
import { forbidden } from '../../../application/shared/errors.js';
import type { ResendWebhook } from '../../../application/webhooks/index.js';
import { auditActor as actor } from '../audit-actor.js';
import {
  eventResponse,
  orderResponse,
  orderStatusResponse,
  paginated,
  toCreateOrderInput,
} from '../dto.js';
import { assertTenantAllowed } from '../middleware/auth.js';
import { optionalParam, parsePagination } from '../query.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';
import type { HttpRequest } from '../types.js';

export interface PaymentOrderControllerDeps {
  create: CreatePaymentOrder;
  get: GetPaymentOrder;
  list: ListPaymentOrders;
  status: GetPaymentOrderStatus;
  events: GetPaymentOrderEvents;
  cancel: CancelPaymentOrder;
  resend: ResendWebhook;
  audit: AuditLogger;
}

/**
 * Payment-order endpoints (TASK-019, spec 08 §3). Creation is idempotent (header +
 * `(tenant_id, external_id)`) and returns `202` (on-chain registration is async). Reads are
 * scope-gated for API keys and constrained by the key's tenant allowlist; cancellation is
 * admin-only.
 */
export function paymentOrderRoutes(deps: PaymentOrderControllerDeps): RouteDefinition[] {
  const guardOrderTenant = async (req: HttpRequest, orderId: string): Promise<void> => {
    if (req.principal?.kind === 'api-key' && req.principal.allowedTenantIds !== null) {
      const view = await deps.get.execute(orderId);
      assertTenantAllowed(req.principal, view.tenantId);
    }
  };

  return [
    {
      method: 'POST',
      path: '/api/payment-orders',
      auth: 'any',
      scopes: ['orders:create'],
      idempotent: true,
      handler: async (req) => {
        const view = await deps.create.execute(toCreateOrderInput(req.json()), {
          correlationId: req.requestId,
          allowedTenantIds: req.principal?.allowedTenantIds ?? null,
        });
        await deps.audit.record({
          ...actor(req.principal),
          action: 'order.create',
          entityType: 'payment_order',
          entityId: view.id,
          correlationId: req.requestId,
          diff: { tenantId: view.tenantId, amount: view.amount, assetCode: view.assetCode },
        });
        return json(202, orderResponse(view));
      },
    },
    {
      method: 'GET',
      path: '/api/payment-orders',
      auth: 'any',
      scopes: ['orders:read'],
      handler: async (req) => {
        const tenantId = optionalParam(req.query, 'tenant_id');
        // An allowlisted API key must scope its listing to a tenant it may see.
        if (req.principal?.kind === 'api-key' && req.principal.allowedTenantIds !== null) {
          if (!tenantId) {
            throw forbidden('FORBIDDEN_TENANT', 'A tenant_id filter is required for this API key');
          }
          assertTenantAllowed(req.principal, tenantId);
        }
        const { limit, offset } = parsePagination(req.query);
        const page = await deps.list.execute({
          tenantId,
          status: optionalParam(req.query, 'status'),
          externalId: optionalParam(req.query, 'external_id'),
          limit,
          offset,
        });
        return json(200, paginated(page, orderResponse));
      },
    },
    {
      method: 'GET',
      path: '/api/payment-orders/:id',
      auth: 'any',
      scopes: ['orders:read'],
      handler: async (req) => {
        const id = req.params['id']!;
        await guardOrderTenant(req, id);
        return json(200, orderResponse(await deps.get.execute(id)));
      },
    },
    {
      method: 'GET',
      path: '/api/payment-orders/:id/status',
      auth: 'any',
      scopes: ['orders:read'],
      handler: async (req) => {
        const id = req.params['id']!;
        await guardOrderTenant(req, id);
        return json(200, orderStatusResponse(await deps.status.execute(id)));
      },
    },
    {
      method: 'GET',
      path: '/api/payment-orders/:id/events',
      auth: 'any',
      scopes: ['orders:read'],
      handler: async (req) => {
        const id = req.params['id']!;
        await guardOrderTenant(req, id);
        const events = await deps.events.execute(id);
        return json(200, { items: events.map(eventResponse) });
      },
    },
    {
      method: 'POST',
      path: '/api/payment-orders/:id/cancel',
      auth: 'admin',
      handler: async (req) => {
        const id = req.params['id']!;
        const view = await deps.cancel.execute(id, req.principal?.label ?? 'admin');
        await deps.audit.record({
          ...actor(req.principal),
          action: 'order.cancel',
          entityType: 'payment_order',
          entityId: id,
          correlationId: req.requestId,
        });
        return json(200, orderResponse(view));
      },
    },
    {
      method: 'POST',
      path: '/api/payment-orders/:id/webhooks/resend',
      auth: 'any',
      scopes: ['webhooks:resend'],
      handler: async (req) => {
        const id = req.params['id']!;
        await guardOrderTenant(req, id);
        const result = await deps.resend.execute(id);
        await deps.audit.record({
          ...actor(req.principal),
          action: 'order.webhook.resend',
          entityType: 'payment_order',
          entityId: id,
          correlationId: req.requestId,
          diff: { eventType: result.eventType, deliveryId: result.deliveryId },
        });
        return json(202, {
          delivery_id: result.deliveryId,
          event_type: result.eventType,
          status: result.status,
        });
      },
    },
  ];
}
