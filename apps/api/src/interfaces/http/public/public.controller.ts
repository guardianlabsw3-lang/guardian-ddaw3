import type { GetPublicPaymentOrder } from '../../../application/payment-order/index.js';
import { publicOrderResponse } from '../dto.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';

export interface PublicControllerDeps {
  publicOrder: GetPublicPaymentOrder;
}

/**
 * Public, unauthenticated payment lookup (TASK-019, spec 08 §3.2). Returns only the data the
 * payer needs and nothing sensitive (no admin email, internal metadata or keys).
 */
export function publicRoutes(deps: PublicControllerDeps): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/api/public/payment-orders/:slug',
      auth: 'none',
      handler: async (req) =>
        json(200, publicOrderResponse(await deps.publicOrder.execute(req.params['slug']!))),
    },
  ];
}
