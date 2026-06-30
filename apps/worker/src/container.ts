import {
  DrizzlePaymentOrderRepository,
  ExpireOrders,
  RegisterOrderOnChain,
  SorobanContractAdapter,
  SyncOrderStatus,
  createDb,
  loadConfig,
  redisConnectionOptions,
  type AppConfig,
  type DbHandle,
  type Logger,
  type PaymentOrderRepository,
  type SorobanContractPort,
} from '@payorder/api';
import type { ConnectionOptions } from 'bullmq';
import { PinoLogger } from './logger.js';

/**
 * Composition root for the worker. Validates the environment (Testnet-locked, like the api),
 * opens the shared PostgreSQL connection, builds the Soroban contract adapter and the
 * framework-free use cases, and exposes the BullMQ Redis connection options. `close` releases
 * the database pool for a graceful shutdown.
 */
export interface WorkerContainer {
  config: AppConfig;
  logger: Logger;
  orders: PaymentOrderRepository;
  contract: SorobanContractPort;
  connection: ConnectionOptions;
  register: RegisterOrderOnChain;
  sync: SyncOrderStatus;
  expire: ExpireOrders;
  close(): Promise<void>;
}

class SystemClock {
  now(): Date {
    return new Date();
  }
}

export function buildContainer(raw: NodeJS.ProcessEnv = process.env): WorkerContainer {
  const config = loadConfig(raw);
  const logger = new PinoLogger(config.logLevel);

  if (!config.stellar.sorobanContractId) {
    throw new Error('SOROBAN_CONTRACT_ID is required to run the worker');
  }
  if (!config.stellar.sorobanAdminSecret) {
    throw new Error('SOROBAN_ADMIN_SECRET is required to run the worker');
  }

  const handle: DbHandle = createDb(config.database.url);
  const orders = new DrizzlePaymentOrderRepository(handle.db);
  const clock = new SystemClock();

  const contract: SorobanContractPort = new SorobanContractAdapter(
    {
      rpcUrl: config.stellar.sorobanRpcUrl,
      networkPassphrase: config.stellar.networkPassphrase,
      contractId: config.stellar.sorobanContractId,
      adminSecret: config.stellar.sorobanAdminSecret,
    },
    logger,
  );

  return {
    config,
    logger,
    orders,
    contract,
    connection: redisConnectionOptions(config.redis.url),
    register: new RegisterOrderOnChain({ orders, contract, clock, logger }),
    sync: new SyncOrderStatus({ orders, contract, clock, logger }),
    expire: new ExpireOrders({ orders, clock, logger }),
    close: () => handle.close(),
  };
}
