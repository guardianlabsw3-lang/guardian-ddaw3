/**
 * Audit trail port (spec 09 §7, spec 10 §10). Critical actions — tenant/wallet changes,
 * order creation/cancellation, webhook resend — are recorded with the actor, action and a
 * **sanitized** diff (never secrets or PII beyond what's needed).
 */
export interface AuditEntry {
  actorType: 'admin' | 'api-key' | 'system';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  correlationId?: string | null;
  diff?: Record<string, unknown> | null;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

/** No-op audit logger for tests and contexts where auditing is not wired. */
export const NOOP_AUDIT: AuditLogger = {
  async record() {},
};
