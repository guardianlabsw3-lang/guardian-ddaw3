/**
 * `Clock` port (spec 03 §7) — injectable time so use cases and expiration logic are
 * deterministic under test.
 */
export interface Clock {
  now(): Date;
}
