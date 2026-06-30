import type { ApiKeyRepository, TokenService } from '../../../application/ports/index.js';
import { forbidden, unauthorized } from '../../../application/shared/errors.js';
import { parseApiKey, verifyApiKeySecret } from '../../../infrastructure/auth/api-key.js';
import type { Middleware, Principal } from '../types.js';

export interface AuthDeps {
  tokens: TokenService;
  apiKeys: ApiKeyRepository;
}

/**
 * Authentication & authorization middleware (spec 08 §1/§6, TASK-020). Resolves the calling
 * principal from an admin `Authorization: Bearer` JWT or an integrator `X-Api-Key`, then
 * enforces the matched route's `auth` requirement and required `scopes`:
 *  - `none`  → skip (public endpoints).
 *  - `admin` → a valid JWT is mandatory; API keys get `403`.
 *  - `any`   → admin **or** API key; API keys must hold every required scope.
 * Admins are full-privilege and bypass scope checks. Missing/invalid credentials → `401`;
 * insufficient privileges → `403`.
 */
export function authMiddleware(deps: AuthDeps): Middleware {
  return async (req, next) => {
    const route = req.route;
    if (!route || route.auth === 'none') {
      return next(req);
    }

    const principal = await resolvePrincipal(req.headers, deps);
    if (!principal) {
      throw unauthorized('UNAUTHENTICATED', 'Authentication required');
    }

    if (route.auth === 'admin' && principal.kind !== 'admin') {
      throw forbidden('FORBIDDEN', 'This operation requires an admin session');
    }

    if (principal.kind === 'api-key' && route.scopes && route.scopes.length > 0) {
      const missing = route.scopes.filter((scope) => !principal.scopes.includes(scope));
      if (missing.length > 0) {
        throw forbidden('FORBIDDEN_SCOPE', 'API key is missing required scope(s)', { missing });
      }
    }

    req.principal = principal;
    return next(req);
  };
}

async function resolvePrincipal(
  headers: Readonly<Record<string, string>>,
  deps: AuthDeps,
): Promise<Principal | null> {
  const authorization = headers['authorization'];
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    const claims = await deps.tokens.verify(authorization.slice(7).trim());
    return {
      kind: 'admin',
      id: claims.sub,
      scopes: [],
      allowedTenantIds: null,
      label: claims.email,
    };
  }

  const presented = headers['x-api-key'];
  if (presented) {
    return resolveApiKey(presented, deps.apiKeys);
  }

  return null;
}

async function resolveApiKey(presented: string, repo: ApiKeyRepository): Promise<Principal> {
  const parsed = parseApiKey(presented);
  if (!parsed) {
    throw unauthorized('UNAUTHENTICATED', 'Malformed API key');
  }
  const record = await repo.findByPrefix(parsed.prefix);
  if (!record || !record.isActive || !verifyApiKeySecret(parsed.secret, record.keyHash)) {
    throw unauthorized('UNAUTHENTICATED', 'Invalid API key');
  }
  return {
    kind: 'api-key',
    id: record.id,
    scopes: record.scopes,
    allowedTenantIds: record.allowedTenantIds,
    label: record.name,
  };
}

/**
 * Enforce an API key's tenant allowlist (spec 08 §6) at the resource level. Admins and keys
 * without a configured allowlist are unrestricted; otherwise the target tenant must be in
 * the allowlist or the caller gets `403 FORBIDDEN_TENANT`.
 */
export function assertTenantAllowed(principal: Principal | undefined, tenantId: string): void {
  if (!principal || principal.kind === 'admin' || principal.allowedTenantIds === null) {
    return;
  }
  if (!principal.allowedTenantIds.includes(tenantId)) {
    throw forbidden('FORBIDDEN_TENANT', 'API key is not allowed to act on this tenant', {
      tenantId,
    });
  }
}
