import type { AuditEntry, AuditLogger, Logger } from '../../application/ports/index.js';
import { NOOP_LOGGER } from '../../application/ports/index.js';
import type { Database } from '../persistence/db.js';
import { auditLogs } from '../persistence/schema/audit.js';

/**
 * Drizzle-backed audit logger over `audit_logs` (spec 09 §7, spec 10 §10). Writes never
 * throw into the caller: a failed audit insert is logged and swallowed so it cannot break a
 * successful business operation. Callers are responsible for passing a **sanitized** diff
 * (no secrets/PII beyond what's needed).
 */
export class DrizzleAuditLogger implements AuditLogger {
  private readonly logger: Logger;

  constructor(
    private readonly db: Database,
    logger: Logger = NOOP_LOGGER,
  ) {
    this.logger = logger;
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        correlationId: entry.correlationId ?? null,
        diff: entry.diff ?? null,
      });
    } catch (err) {
      this.logger.error('failed to write audit log', {
        action: entry.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
