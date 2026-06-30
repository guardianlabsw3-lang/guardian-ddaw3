import type { OrderRegistrationQueue, RegisterOrderJob } from '../../application/ports/index.js';

/**
 * In-memory `OrderRegistrationQueue`. Used in tests and local single-process runs; the
 * BullMQ/Redis-backed implementation arrives in TASK-016. Enqueued jobs are kept so they
 * can be inspected/drained.
 */
export class InMemoryOrderRegistrationQueue implements OrderRegistrationQueue {
  readonly jobs: RegisterOrderJob[] = [];

  async enqueueRegister(job: RegisterOrderJob): Promise<void> {
    this.jobs.push(job);
  }

  drain(): RegisterOrderJob[] {
    return this.jobs.splice(0, this.jobs.length);
  }
}
