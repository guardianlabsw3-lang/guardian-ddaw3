import {
  ActivateTenant,
  AssignTenantWallet,
  CancelPaymentOrder,
  CreatePaymentOrder,
  CreateTenant,
  DeactivateTenant,
  ExpireOrders,
  GetPaymentOrder,
  GetPaymentOrderEvents,
  GetPaymentOrderStatus,
  GetPublicPaymentOrder,
  GetTenant,
  GetTenantWallet,
  ListPaymentOrders,
  ListTenants,
  LoginAdmin,
  RegisterOrderOnChain,
  ResendWebhook,
  SyncOrderStatus,
  WebhookDispatcher,
  type RegisterOrderJob,
  type SyncOrderResult,
} from '../../src/application/index.js';
import { Base58SlugGenerator, UuidV7IdGenerator } from '../../src/infrastructure/adapters/index.js';
import {
  Argon2PasswordHasher,
  HmacJwtService,
  generateApiKey,
} from '../../src/infrastructure/auth/index.js';
import { InMemoryOrderRegistrationQueue } from '../../src/infrastructure/queue/index.js';
import { InMemoryRateLimiter } from '../../src/infrastructure/ratelimit/index.js';
import {
  authRoutes,
  createApp,
  createHttpRequest,
  healthRoutes,
  paymentOrderRoutes,
  publicRoutes,
  tenantRoutes,
  type App,
  type HttpResponse,
} from '../../src/interfaces/http/index.js';
import { FixedClock, MockSorobanContract, RecordingLogger } from '../fakes.js';
import {
  FakeWebhookSender,
  InMemoryAdminUserRepository,
  InMemoryApiKeyRepository,
  InMemoryIdempotencyStore,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  InMemoryWebhookDeliveryRepository,
} from '../http/fakes.js';

const JWT_SECRET = 'e2e-secret-please-ignore';
const PUBLIC_WEB_URL = 'http://localhost:3001';
const EXPLORER = 'https://stellar.expert/explorer/testnet';

/** Wall-clock start for the deterministic E2E clock. */
export const E2E_NOW = new Date('2026-06-30T12:00:00Z');

export interface E2EHarness {
  app: App;
  clock: FixedClock;
  contract: MockSorobanContract;
  queue: InMemoryOrderRegistrationQueue;
  logger: RecordingLogger;
  tenants: InMemoryTenantRepository;
  orders: InMemoryPaymentOrderRepository;
  sender: FakeWebhookSender;
  adminToken: string;
  adminEmail: string;
  adminPassword: string;
  /** A full-scope API key plaintext (`pk_...`). */
  apiKey: string;
  request(input: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<HttpResponse>;
  /**
   * Run the registration worker (TASK-016) over every job the API enqueued, driving each
   * `CREATED` order to `ACTIVE` on-chain. Returns the jobs it processed.
   */
  processRegistrations(): Promise<RegisterOrderJob[]>;
  /** Simulate the payer's on-chain `pay`: script the contract to report the order `PAID`. */
  confirmOnChainPayment(orderId: string, payer: string, paidAt?: Date): void;
  /** Run the reconciliation worker (TASK-017) for a single order. */
  syncOrder(orderId: string): Promise<SyncOrderResult>;
  /** Run the expiration worker (TASK-017) over all due `ACTIVE` orders. */
  expireDueOrders(): Promise<{ scanned: number; expired: number }>;
}

export interface E2EHarnessOptions {
  /** Restrict the seeded API key to these tenant ids (allowlist). */
  apiKeyTenants?: string[] | null;
  apiKeyScopes?: string[];
}

/**
 * Full-stack, DB-free E2E harness (TASK-030, spec 11 §8). It wires the real HTTP app exactly
 * as production does **and** the worker use cases (register / sync / expire) over a shared
 * in-memory order repository and a {@link MockSorobanContract} standing in for the on-chain
 * authority. A single test can therefore drive the whole 9-step journey — create tenant →
 * assign wallet → create order (tenant+amount only) → register on-chain → query the public
 * link → confirm the payment → reconcile to `PAID` — and assert duplicate payments are
 * blocked, without a browser, a database, or the Testnet.
 */
export async function buildE2EHarness(options: E2EHarnessOptions = {}): Promise<E2EHarness> {
  const clock = new FixedClock(E2E_NOW);
  const contract = new MockSorobanContract();
  const logger = new RecordingLogger();

  const tenants = new InMemoryTenantRepository();
  const orders = new InMemoryPaymentOrderRepository();
  const admins = new InMemoryAdminUserRepository();
  const apiKeys = new InMemoryApiKeyRepository();
  const deliveries = new InMemoryWebhookDeliveryRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const sender = new FakeWebhookSender({ ok: true, status: 200 });

  const ids = new UuidV7IdGenerator();
  const slugs = new Base58SlugGenerator();
  const queue = new InMemoryOrderRegistrationQueue();
  const tokens = new HmacJwtService(JWT_SECRET);
  const hasher = new Argon2PasswordHasher();

  const webhooks = new WebhookDispatcher({
    deliveries,
    sender,
    clock,
    signingSecret: 'webhook-secret-please-ignore',
  });

  // Worker use cases share the same repository + contract the API writes to.
  const registerWorker = new RegisterOrderOnChain({ orders, contract, clock, logger });
  const syncWorker = new SyncOrderStatus({ orders, contract, clock, logger });
  const expireWorker = new ExpireOrders({ orders, clock, logger });

  // Seed an admin user and a full-scope API key.
  const adminPassword = 'sup3r-secret-pass';
  const adminEmail = 'admin@acme.test';
  const admin = await admins.create({
    email: adminEmail,
    passwordHash: await hasher.hash(adminPassword),
  });
  const adminToken = await tokens.sign(
    { sub: admin.id, email: admin.email, role: admin.role },
    3600,
  );

  const generated = generateApiKey();
  await apiKeys.create({
    name: 'e2e-key',
    keyPrefix: generated.prefix,
    keyHash: generated.keyHash,
    scopes: options.apiKeyScopes ?? ['orders:create', 'orders:read', 'webhooks:resend'],
    allowedTenantIds: options.apiKeyTenants ?? null,
  });

  const routes = [
    ...authRoutes({ login: new LoginAdmin({ admins, hasher, tokens }) }),
    ...tenantRoutes({
      create: new CreateTenant(tenants, ids, slugs, clock),
      list: new ListTenants(tenants),
      get: new GetTenant(tenants),
      activate: new ActivateTenant(tenants, clock),
      deactivate: new DeactivateTenant(tenants, clock),
      assignWallet: new AssignTenantWallet(tenants, orders, clock),
      getWallet: new GetTenantWallet(tenants),
      audit: { async record() {} },
    }),
    ...paymentOrderRoutes({
      create: new CreatePaymentOrder({
        tenants,
        orders,
        ids,
        slugs,
        clock,
        registrationQueue: queue,
        publicWebUrl: PUBLIC_WEB_URL,
      }),
      get: new GetPaymentOrder(orders, PUBLIC_WEB_URL),
      list: new ListPaymentOrders(orders, PUBLIC_WEB_URL),
      status: new GetPaymentOrderStatus(orders, EXPLORER),
      events: new GetPaymentOrderEvents(orders),
      cancel: new CancelPaymentOrder({ orders, clock, publicWebUrl: PUBLIC_WEB_URL, webhooks }),
      resend: new ResendWebhook(orders, webhooks),
      audit: { async record() {} },
    }),
    ...publicRoutes({
      publicOrder: new GetPublicPaymentOrder({
        orders,
        tenants,
        network: 'TESTNET',
        explorerBaseUrl: EXPLORER,
      }),
    }),
    ...healthRoutes({
      checks: [{ name: 'database', check: async () => true }],
    }),
  ];

  const app = createApp({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tokens,
    apiKeys,
    rateLimiter: new InMemoryRateLimiter({ limit: 10_000, windowMs: 60_000 }),
    idempotencyStore,
    corsOrigins: ['http://localhost:3001'],
    routes,
  });

  const request: E2EHarness['request'] = ({ method, path, headers = {}, body }) => {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    return app.handle(createHttpRequest({ method, url: path, headers, rawBody }));
  };

  const processRegistrations: E2EHarness['processRegistrations'] = async () => {
    const jobs = queue.drain();
    for (const job of jobs) {
      await registerWorker.execute(job);
    }
    return jobs;
  };

  const confirmOnChainPayment: E2EHarness['confirmOnChainPayment'] = (orderId, payer, paidAt) => {
    contract.setOnChain(orderId, { status: 'PAID', payer, paidAt: paidAt ?? clock.now() });
  };

  return {
    app,
    clock,
    contract,
    queue,
    logger,
    tenants,
    orders,
    sender,
    adminToken,
    adminEmail,
    adminPassword,
    apiKey: generated.plaintext,
    request,
    processRegistrations,
    confirmOnChainPayment,
    syncOrder: (orderId) => syncWorker.execute(orderId),
    expireDueOrders: () => expireWorker.execute(),
  };
}

/**
 * Onboard an ACTIVE tenant with a Testnet wallet via the admin endpoints — steps 1–2 of the
 * E2E flow. Returns the tenant id (and its document for document-resolution tests).
 */
export async function onboardTenant(
  h: E2EHarness,
  walletKey: string,
  documentNumber = '11222333000181',
): Promise<{ tenantId: string; documentNumber: string }> {
  const auth = { authorization: `Bearer ${h.adminToken}` };
  const created = await h.request({
    method: 'POST',
    path: '/api/tenants',
    headers: auth,
    body: {
      name: 'ACME Pagamentos',
      legal_name: 'ACME Pagamentos LTDA',
      document_type: 'CNPJ',
      document_number: documentNumber,
      admin_email: 'fin@acme.com.br',
      default_asset_code: 'XLM',
      default_asset_issuer: null,
    },
  });
  const tenantId = (created.body as { id: string }).id;
  await h.request({
    method: 'PUT',
    path: `/api/tenants/${tenantId}/wallet`,
    headers: auth,
    body: { stellar_wallet_public_key: walletKey, stellar_network: 'TESTNET' },
  });
  await h.request({ method: 'POST', path: `/api/tenants/${tenantId}/activate`, headers: auth });
  return { tenantId, documentNumber };
}
