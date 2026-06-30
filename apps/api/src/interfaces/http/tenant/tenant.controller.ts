import type { TenantStatus } from '@payorder/shared';
import type {
  ActivateTenant,
  AssignTenantWallet,
  CreateTenant,
  DeactivateTenant,
  GetTenant,
  GetTenantWallet,
  ListTenants,
} from '../../../application/tenant/index.js';
import type { AuditLogger } from '../../../application/ports/index.js';
import { notFound } from '../../../application/shared/errors.js';
import { auditActor as actor } from '../audit-actor.js';
import {
  paginated,
  tenantResponse,
  toAssignWalletInput,
  toCreateTenantInput,
  walletResponse,
} from '../dto.js';
import { optionalParam, parsePagination } from '../query.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';

export interface TenantControllerDeps {
  create: CreateTenant;
  list: ListTenants;
  get: GetTenant;
  activate: ActivateTenant;
  deactivate: DeactivateTenant;
  assignWallet: AssignTenantWallet;
  getWallet: GetTenantWallet;
  audit: AuditLogger;
}

/**
 * Tenant admin endpoints (TASK-018, spec 08 §2). All routes are admin-only (JWT). Critical
 * mutations — create, wallet change, activation toggles — are written to the audit trail
 * with the acting admin and a sanitized diff (spec 10 §10).
 */
export function tenantRoutes(deps: TenantControllerDeps): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/tenants',
      auth: 'admin',
      handler: async (req) => {
        const view = await deps.create.execute(toCreateTenantInput(req.json()));
        await deps.audit.record({
          ...actor(req.principal),
          action: 'tenant.create',
          entityType: 'tenant',
          entityId: view.id,
          correlationId: req.requestId,
          diff: { name: view.name, document: view.document.type },
        });
        return json(201, tenantResponse(view));
      },
    },
    {
      method: 'GET',
      path: '/api/tenants',
      auth: 'admin',
      handler: async (req) => {
        const { limit, offset } = parsePagination(req.query);
        const page = await deps.list.execute({
          status: optionalParam(req.query, 'status') as TenantStatus | undefined,
          document: optionalParam(req.query, 'document'),
          limit,
          offset,
        });
        return json(200, paginated(page, tenantResponse));
      },
    },
    {
      method: 'GET',
      path: '/api/tenants/:id',
      auth: 'admin',
      handler: async (req) => json(200, tenantResponse(await deps.get.execute(req.params['id']!))),
    },
    {
      method: 'POST',
      path: '/api/tenants/:id/activate',
      auth: 'admin',
      handler: async (req) => {
        const view = await deps.activate.execute(req.params['id']!);
        await deps.audit.record({
          ...actor(req.principal),
          action: 'tenant.activate',
          entityType: 'tenant',
          entityId: view.id,
          correlationId: req.requestId,
        });
        return json(200, tenantResponse(view));
      },
    },
    {
      method: 'POST',
      path: '/api/tenants/:id/deactivate',
      auth: 'admin',
      handler: async (req) => {
        const view = await deps.deactivate.execute(req.params['id']!);
        await deps.audit.record({
          ...actor(req.principal),
          action: 'tenant.deactivate',
          entityType: 'tenant',
          entityId: view.id,
          correlationId: req.requestId,
        });
        return json(200, tenantResponse(view));
      },
    },
    {
      method: 'PUT',
      path: '/api/tenants/:id/wallet',
      auth: 'admin',
      handler: async (req) => {
        const id = req.params['id']!;
        const wallet = await deps.assignWallet.execute(id, toAssignWalletInput(req.json()));
        await deps.audit.record({
          ...actor(req.principal),
          action: 'tenant.wallet.assign',
          entityType: 'tenant',
          entityId: id,
          correlationId: req.requestId,
          diff: { walletPublicKey: wallet.publicKey, network: wallet.network },
        });
        return json(200, walletResponse(wallet));
      },
    },
    {
      method: 'GET',
      path: '/api/tenants/:id/wallet',
      auth: 'admin',
      handler: async (req) => {
        const wallet = await deps.getWallet.execute(req.params['id']!);
        if (!wallet) {
          throw notFound('TENANT_WALLET_NOT_SET', 'Tenant has no wallet configured', {
            id: req.params['id'],
          });
        }
        return json(200, walletResponse(wallet));
      },
    },
  ];
}
