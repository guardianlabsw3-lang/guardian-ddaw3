import type { LoginAdmin } from '../../../application/auth/index.js';
import { loginResponse } from '../dto.js';
import type { RouteDefinition } from '../router.js';
import { json } from '../types.js';

export interface AuthControllerDeps {
  login: LoginAdmin;
}

/** Admin authentication endpoint (TASK-020, spec 08 §1). */
export function authRoutes(deps: AuthControllerDeps): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/auth/login',
      auth: 'none',
      handler: async (req) => json(200, loginResponse(await deps.login.execute(req.json()))),
    },
  ];
}
