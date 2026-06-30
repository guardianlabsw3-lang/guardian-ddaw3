/**
 * Shared BullMQ queue and job names (spec 04 §5: API ↔ Worker via Redis queues). Declared in
 * the api so the producer (here) and the worker consumer agree on a single source of truth.
 */
export const ORDER_REGISTRATION_QUEUE = 'order-registration';
export const REGISTER_ORDER_JOB = 'register-order';

/**
 * Default job options for on-chain registration: bounded retries with exponential backoff
 * (TASK-016 "retries"), and completed/failed-job retention so the queue doesn't grow
 * unbounded. Soroban confirmation is slow, so the backoff is generous.
 */
export const REGISTER_ORDER_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};
