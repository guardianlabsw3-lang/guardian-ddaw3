import type { Clock } from '../../application/ports/index.js';

/** Production `Clock` — wall-clock UTC time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
