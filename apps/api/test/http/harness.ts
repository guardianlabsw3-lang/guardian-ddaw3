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
} from '../../src/application/index.js';
import type { AuditEntry, AuditLogger } from '../../src/application/ports/index.js';
import {
  Base58SlugGenerator,
  SystemClock,
  UuidV7IdGenerator,
} from '../../src/infrastructure/adapters/index.js';
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
import {
  FakeWebhookSender,
  InMemoryAdminUserRepository,
  InMemoryApiKeyRepository,
  InMemoryIdempotencyStore,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  InMemoryWebhookDeliveryRepository,
} from './fakes.js';

const JWT_SECRET = 'test-secret-please-ignore';
const PUBLIC_WEB_URL = 'http://localhost:3001';
const EXPLORER = 'https://stellar.expert/explorer/testnet';

class FakeAudit implements AuditLogger {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export interface TestHarness {
  app: App;
  tenants: InMemoryTenantRepository;
  orders: InMemoryPaymentOrderRepository;
  apiKeys: InMemoryApiKeyRepository;
  admins: InMemoryAdminUserRepository;
  sender: FakeWebhookSender;
  audit: FakeAudit;
  adminToken: string;
  adminPassword: string;
  adminEmail: string;
  /** A full-scope API key plaintext (`pk_...`). */
  apiKey: string;
  request(input: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<HttpResponse>;
}

export interface HarnessOptions {
  rateLimit?: number;
  webhookOk?: boolean;
  /** Restrict the seeded API key to these tenant ids (allowlist). */
  apiKeyTenants?: string[] | null;
  apiKeyScopes?: string[];
}

/**
 * Build the full HTTP app over in-memory fakes with real use cases, auth, idempotency,
 * rate-limiting and webhook dispatch — a fast, DB-free integration harness for the API
 * contract tests (spec 11 §5 keeps integration close to production wiring).
 */
export async function buildHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const tenants = new InMemoryTenantRepository();
  const orders = new InMemoryPaymentOrderRepository();
  const admins = new InMemoryAdminUserRepository();
  const apiKeys = new InMemoryApiKeyRepository();
  const deliveries = new InMemoryWebhookDeliveryRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const sender = new FakeWebhookSender({ ok: options.webhookOk ?? true, status: 200 });
  const audit = new FakeAudit();

  const clock = new SystemClock();
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

  // Seed an admin user and an API key.
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
    name: 'integration-key',
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
        publicWebUrl: PUBLIC_WEB_URL,
      }),
      get: new GetPaymentOrder(orders, PUBLIC_WEB_URL),
      list: new ListPaymentOrders(orders, PUBLIC_WEB_URL),
      status: new GetPaymentOrderStatus(orders, EXPLORER),
      events: new GetPaymentOrderEvents(orders),
      cancel: new CancelPaymentOrder({ orders, clock, publicWebUrl: PUBLIC_WEB_URL, webhooks }),
      resend: new ResendWebhook(orders, webhooks),
      audit,
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
    rateLimiter: new InMemoryRateLimiter({ limit: options.rateLimit ?? 1000, windowMs: 60_000 }),
    idempotencyStore,
    corsOrigins: ['http://localhost:3001'],
    routes,
  });

  const request: TestHarness['request'] = ({ method, path, headers = {}, body }) => {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    return app.handle(createHttpRequest({ method, url: path, headers, rawBody }));
  };

  return {
    app,
    tenants,
    orders,
    apiKeys,
    admins,
    sender,
    audit,
    adminToken,
    adminPassword,
    adminEmail,
    apiKey: generated.plaintext,
    request,
  };
}

/** Helper: seed an ACTIVE tenant with a wallet via the admin endpoints; returns its id. */
export async function seedActiveTenant(
  harness: TestHarness,
  walletKey: string,
  documentNumber = '11222333000181',
): Promise<string> {
  const auth = { authorization: `Bearer ${harness.adminToken}` };
  const created = await harness.request({
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
  await harness.request({
    method: 'PUT',
    path: `/api/tenants/${tenantId}/wallet`,
    headers: auth,
    body: { stellar_wallet_public_key: walletKey, stellar_network: 'TESTNET' },
  });
  await harness.request({
    method: 'POST',
    path: `/api/tenants/${tenantId}/activate`,
    headers: auth,
  });
  return tenantId;
}
