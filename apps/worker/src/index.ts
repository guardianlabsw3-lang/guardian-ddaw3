import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { buildContainer, type WorkerContainer } from './container.js';
import { createRegistrationWorker } from './jobs/register-order.js';
import { syncStatusSweep } from './jobs/sync-status.js';
import { expireOrdersSweep } from './jobs/expire-orders.js';

/**
 * `@payorder/worker` entrypoint (TASK-016..017). Runs three responsibilities:
 *
 *  1. `register-order`  — consumes the registration queue (api producer) and drives
 *                          `CREATED → ACTIVE` on-chain.
 *  2. `sync-status`     — periodic reconciliation of on-chain → off-chain status.
 *  3. `expire-orders`   — periodic expiration of overdue `ACTIVE` orders.
 *
 * (2) and (3) are repeatable jobs on a single "maintenance" queue so scheduling is durable in
 * Redis (survives restarts) rather than living in process timers.
 */
const MAINTENANCE_QUEUE = 'maintenance';
const SYNC_STATUS_JOB = 'sync-status';
const EXPIRE_ORDERS_JOB = 'expire-orders';

const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const DEFAULT_EXPIRE_INTERVAL_MS = 60_000;

function intervalFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function scheduleMaintenance(connection: ConnectionOptions): Promise<Queue> {
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  const opts = { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } };
  await queue.add(
    SYNC_STATUS_JOB,
    {},
    {
      ...opts,
      repeat: { every: intervalFromEnv('SYNC_INTERVAL_MS', DEFAULT_SYNC_INTERVAL_MS) },
    },
  );
  await queue.add(
    EXPIRE_ORDERS_JOB,
    {},
    {
      ...opts,
      repeat: { every: intervalFromEnv('EXPIRE_INTERVAL_MS', DEFAULT_EXPIRE_INTERVAL_MS) },
    },
  );
  return queue;
}

function createMaintenanceWorker(container: WorkerContainer): Worker {
  return new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === SYNC_STATUS_JOB) {
        await syncStatusSweep({
          orders: container.orders,
          sync: container.sync,
          logger: container.logger,
        });
      } else if (job.name === EXPIRE_ORDERS_JOB) {
        await expireOrdersSweep({ expire: container.expire, logger: container.logger });
      }
    },
    { connection: container.connection, concurrency: 1 },
  );
}

async function main(): Promise<void> {
  const container = buildContainer();
  const { logger } = container;
  logger.info('worker: starting', { contractId: container.contract.contractId });

  const registrationWorker = createRegistrationWorker({
    connection: container.connection,
    register: container.register,
    logger,
  });
  const maintenanceQueue = await scheduleMaintenance(container.connection);
  const maintenanceWorker = createMaintenanceWorker(container);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('worker: shutting down', { signal });
    await Promise.allSettled([
      registrationWorker.close(),
      maintenanceWorker.close(),
      maintenanceQueue.close(),
    ]);
    await container.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('worker: ready');
}

main().catch((error: unknown) => {
  console.error('worker: fatal startup error', error);
  process.exit(1);
});
