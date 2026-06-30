import type { Principal } from './types.js';

/** Map a request principal to audit `actor_type`/`actor_id` fields (spec 10 §10). */
export function auditActor(principal: Principal | undefined): {
  actorType: 'admin' | 'api-key' | 'system';
  actorId: string | null;
} {
  if (!principal) {
    return { actorType: 'system', actorId: null };
  }
  return { actorType: principal.kind, actorId: principal.id };
}
