/**
 * `OrderRegistrationQueue` port — enqueues the asynchronous on-chain registration job
 * (spec 04 §7, ADR-06). `CreatePaymentOrder` persists `CREATED` then enqueues; the worker
 * (TASK-016) registers the order and transitions it to `ACTIVE`.
 */
export interface RegisterOrderJob {
  paymentOrderId: string;
  correlationId?: string | null;
}

export interface OrderRegistrationQueue {
  enqueueRegister(job: RegisterOrderJob): Promise<void>;
}
