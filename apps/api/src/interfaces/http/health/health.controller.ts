import type { ReadinessCheck } from '../../../infrastructure/observability/health-checks.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';

export interface HealthControllerDeps {
  checks: ReadinessCheck[];
}

/**
 * Liveness and readiness probes (TASK-023, spec 15). `/health` is a cheap liveness signal;
 * `/ready` runs the dependency checks (DB, Redis, RPC) and returns `503` with a per-check
 * breakdown if any is down, so orchestrators can gate traffic.
 */
export function healthRoutes(deps: HealthControllerDeps): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/health',
      auth: 'none',
      handler: () => json(200, { status: 'ok' }),
    },
    {
      method: 'GET',
      path: '/ready',
      auth: 'none',
      handler: async () => {
        const results = await Promise.all(
          deps.checks.map(async (c) => {
            try {
              return [c.name, (await c.check()) ? 'up' : 'down'] as const;
            } catch {
              return [c.name, 'down'] as const;
            }
          }),
        );
        const checks = Object.fromEntries(results);
        const ready = results.every(([, state]) => state === 'up');
        return json(ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks });
      },
    },
  ];
}
