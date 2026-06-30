import {
  ActivateTenant,
  AssignTenantWallet,
  CancelPaymentOrder,
  CreatePaymentOrder,
  CreateTenant,
  DeactivateTenant,
  GetPaymentOrder,
  GetPaymentOrderEvents,
  GetPaymentOrderStatus,
  GetPublicPaymentOrder,
  GetTenant,
  GetTenantWallet,
  ListPaymentOrders,
  ListTenants,
  LoginAdmin,
  ResendWebhook,
  WebhookDispatcher,
} from './application/index.js';
import {
  Base58SlugGenerator,
  SystemClock,
  UuidV7IdGenerator,
} from './infrastructure/adapters/index.js';
import { DrizzleAuditLogger } from './infrastructure/audit/index.js';
import {
  Argon2PasswordHasher,
  DrizzleAdminUserRepository,
  DrizzleApiKeyRepository,
  HmacJwtService,
} from './infrastructure/auth/index.js';
import type { AppConfig } from './infrastructure/config/index.js';
import { loadConfig } from './infrastructure/config/index.js';
import { DrizzleIdempotencyStore } from './infrastructure/idempotency/index.js';
import {
  ConsoleLogger,
  databaseCheck,
  redisCheck,
  sorobanRpcCheck,
} from './infrastructure/observability/index.js';
import { createDb, type DbHandle } from './infrastructure/persistence/index.js';
import {
  DrizzlePaymentOrderRepository,
  DrizzleTenantRepository,
} from './infrastructure/persistence/index.js';
import {
  BullmqOrderRegistrationQueue,
  redisConnectionOptions,
} from './infrastructure/queue/index.js';
import { InMemoryRateLimiter } from './infrastructure/ratelimit/index.js';
import {
  DrizzleWebhookDeliveryRepository,
  FetchWebhookSender,
} from './infrastructure/webhooks/index.js';
import {
  authRoutes,
  createApp,
  createHttpServer,
  healthRoutes,
  paymentOrderRoutes,
  publicRoutes,
  tenantRoutes,
  type App,
} from './interfaces/http/index.js';
import type { Logger } from './application/ports/index.js';

/** Stellar.expert explorer roots keyed by network (spec 08 §3.2). */
const EXPLORER_BASE: Record<string, string> = {
  TESTNET: 'https://stellar.expert/explorer/testnet',
  PUBLIC: 'https://stellar.expert/explorer/public',
};

/** Default request budget per minute, per principal/IP (spec 10 §5). */
const RATE_LIMIT_PER_MINUTE = 120;

export interface ApiContainer {
  config: AppConfig;
  logger: Logger;
  app: App;
  /** Release the database pool and queue connection for a graceful shutdown. */
  close(): Promise<void>;
}

/**
 * API composition root (TASK-018..023). Mirrors the worker container: validates the
 * Testnet-locked environment, opens the shared PostgreSQL pool, and wires the framework-free
 * use cases to their Drizzle repositories, the auth/idempotency/webhook infrastructure and
 * the HTTP application. Nothing here depends on a web framework.
 */
export function buildApiContainer(raw: NodeJS.ProcessEnv = process.env): ApiContainer {
  const config = loadConfig(raw);
  const logger = new ConsoleLogger(mapLogLevel(config.logLevel));

  const handle: DbHandle = createDb(config.database.url);
  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator();
  const slugs = new Base58SlugGenerator();

  const tenants = new DrizzleTenantRepository(handle.db);
  const orders = new DrizzlePaymentOrderRepository(handle.db);
  const adminUsers = new DrizzleAdminUserRepository(handle.db);
  const apiKeys = new DrizzleApiKeyRepository(handle.db);
  const deliveries = new DrizzleWebhookDeliveryRepository(handle.db);

  const queue = new BullmqOrderRegistrationQueue(redisConnectionOptions(config.redis.url));
  const tokens = new HmacJwtService(config.auth.jwtSecret);
  const hasher = new Argon2PasswordHasher();
  const audit = new DrizzleAuditLogger(handle.db, logger);
  const idempotencyStore = new DrizzleIdempotencyStore(handle.db);
  const rateLimiter = new InMemoryRateLimiter({ limit: RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });

  const explorerBaseUrl = EXPLORER_BASE[config.stellar.network] ?? EXPLORER_BASE.TESTNET!;
  const publicWebUrl = config.publicWebUrl;

  const webhooks = new WebhookDispatcher({
    deliveries,
    sender: new FetchWebhookSender(),
    clock,
    signingSecret: config.webhooks.signingSecret,
    logger,
  });

  const routes = [
    ...authRoutes({ login: new LoginAdmin({ admins: adminUsers, hasher, tokens }) }),
    ...tenantRoutes({
      create: new CreateTenant(tenants, ids, slugs, clock),
      list: new ListTenants(tenants),
      get: new GetTenant(tenants),
      activate: new ActivateTenant(tenants, clock),
      deactivate: new DeactivateTenant(tenants, clock),
      assignWallet: new AssignTenantWallet(tenants, orders, clock),
      getWallet: new GetTenantWallet(tenants),
      audit,
    }),
    ...paymentOrderRoutes({
      create: new CreatePaymentOrder({
        tenants,
        orders,
        ids,
        slugs,
        clock,
        registrationQueue: queue,
        publicWebUrl,
      }),
      get: new GetPaymentOrder(orders, publicWebUrl),
      list: new ListPaymentOrders(orders, publicWebUrl),
      status: new GetPaymentOrderStatus(orders, explorerBaseUrl),
      events: new GetPaymentOrderEvents(orders),
      cancel: new CancelPaymentOrder({ orders, clock, publicWebUrl, webhooks }),
      resend: new ResendWebhook(orders, webhooks),
      audit,
    }),
    ...publicRoutes({
      publicOrder: new GetPublicPaymentOrder({
        orders,
        tenants,
        network: config.stellar.network,
        explorerBaseUrl,
      }),
    }),
    ...healthRoutes({
      checks: [
        databaseCheck(handle.sql),
        redisCheck(config.redis.url),
        sorobanRpcCheck(config.stellar.sorobanRpcUrl),
      ],
    }),
  ];

  const app = createApp({
    logger,
    tokens,
    apiKeys,
    rateLimiter,
    idempotencyStore,
    corsOrigins: config.api.corsOrigins,
    routes,
  });

  return {
    config,
    logger,
    app,
    close: async () => {
      await queue.close();
      await handle.close();
    },
  };
}

export { createHttpServer };

function mapLogLevel(level: AppConfig['logLevel']): 'debug' | 'info' | 'warn' | 'error' {
  if (level === 'fatal') {
    return 'error';
  }
  if (level === 'trace') {
    return 'debug';
  }
  return level;
}
