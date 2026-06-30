import { Queue, type ConnectionOptions } from 'bullmq';
import type { OrderRegistrationQueue, RegisterOrderJob } from '../../application/ports/index.js';
import {
  ORDER_REGISTRATION_QUEUE,
  REGISTER_ORDER_JOB,
  REGISTER_ORDER_JOB_OPTIONS,
} from './queue-names.js';

/**
 * BullMQ-backed `OrderRegistrationQueue` producer (spec 04 §5, ADR-06). `CreatePaymentOrder`
 * enqueues here after persisting a `CREATED` order; the worker (`@payorder/worker`) consumes
 * `register-order` jobs and drives the on-chain registration. Jobs are keyed by the order id
 * so a duplicate enqueue (e.g. a retried request) collapses to a single job — the on-chain
 * registration is idempotent regardless, but this avoids redundant work.
 */
export class BullmqOrderRegistrationQueue implements OrderRegistrationQueue {
  private readonly queue: Queue<RegisterOrderJob>;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue(ORDER_REGISTRATION_QUEUE, { connection });
  }

  async enqueueRegister(job: RegisterOrderJob): Promise<void> {
    await this.queue.add(REGISTER_ORDER_JOB, job, {
      jobId: job.paymentOrderId,
      ...REGISTER_ORDER_JOB_OPTIONS,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
