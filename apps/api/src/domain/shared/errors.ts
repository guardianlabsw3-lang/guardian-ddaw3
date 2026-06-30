/**
 * Domain errors are pure (framework-free). Each carries a stable `code` that the
 * application/interface layers map to HTTP responses (see spec 08 §1 error envelope and
 * the per-feature error tables in specs 05/06). The domain never imports HTTP concepts.
 */

export class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    // Preserve prototype chain when targeting ES2022 class extends Error.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when a state-machine transition is not allowed (spec 03 §3). The terminal states
 * `PAID`/`EXPIRED`/`CANCELLED`/`FAILED` have no outgoing transitions.
 */
export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `Cannot transition payment order from ${from} to ${to}`, {
      from,
      to,
    });
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
