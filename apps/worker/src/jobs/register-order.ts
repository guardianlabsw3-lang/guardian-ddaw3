import { Worker, type ConnectionOptions } from 'bullmq';
import {
  ORDER_REGISTRATION_QUEUE,
  type Logger,
  type RegisterOrderJob,
  type RegisterOrderOnChain,
} from '@payorder/api';

/**
 * TASK-016 — the BullMQ consumer that drives `CREATED → ACTIVE` on-chain registration.
 *
 * Each `register-order` job runs {@link RegisterOrderOnChain}, which is idempotent, so the
 * queue's at-least-once delivery and automatic retries are safe. When a job exhausts its
 * configured attempts, the order is moved to `FAILED` (the registration permanently failed),
 * closing the lifecycle instead of leaving it stuck in `CREATED`.
 */
export interface RegistrationWorkerDeps {
  connection: ConnectionOptions;
  register: RegisterOrderOnChain;
  logger: Logger;
  concurrency?: number;
}

export function createRegistrationWorker(deps: RegistrationWorkerDeps): Worker<RegisterOrderJob> {
  const worker = new Worker<RegisterOrderJob>(
    ORDER_REGISTRATION_QUEUE,
    async (job) => deps.register.execute(job.data),
    { connection: deps.connection, concurrency: deps.concurrency ?? 5 },
  );

  worker.on('failed', (job, err) => {
    if (!job) {
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    deps.logger.warn('register-order: job failed', {
      paymentOrderId: job.data.paymentOrderId,
      attempt: job.attemptsMade,
      maxAttempts,
      error: err.message,
    });
    if (job.attemptsMade >= maxAttempts) {
      void deps.register
        .markFailed(job.data.paymentOrderId, err.message)
        .catch((markErr: unknown) =>
          deps.logger.error('register-order: markFailed errored', {
            paymentOrderId: job.data.paymentOrderId,
            error: String(markErr),
          }),
        );
    }
  });

  return worker;
}
