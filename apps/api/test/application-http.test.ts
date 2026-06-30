import { describe, expect, it } from 'vitest';
import { PaymentOrder } from '../src/domain/payment-order/index.js';
import {
  GetPaymentOrder,
  GetPaymentOrderEvents,
  GetPaymentOrderStatus,
  GetPublicPaymentOrder,
  ListPaymentOrders,
  maskDocument,
} from '../src/application/payment-order/index.js';
import { LoginAdmin } from '../src/application/auth/index.js';
import {
  ResendWebhook,
  RetryDueWebhooks,
  WebhookDispatcher,
} from '../src/application/webhooks/index.js';
import type { AdminUserRecord } from '../src/application/ports/index.js';
import {
  FakeWebhookSender,
  InMemoryAdminUserRepository,
  InMemoryPaymentOrderRepository,
  InMemoryTenantRepository,
  InMemoryWebhookDeliveryRepository,
} from './http/fakes.js';
import { XLM, TENANT_WALLET, expectAppError, publicSlug } from './fixtures.js';
import { Argon2PasswordHasher, HmacJwtService } from '../src/infrastructure/auth/index.js';

const FIXED = new Date('2026-06-30T12:00:00Z');
const clock = { now: () => FIXED };

function makeOrder(opts: { metadata?: Record<string, unknown>; slug?: string } = {}): PaymentOrder {
  return PaymentOrder.create({
    id: `00000000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`,
    tenantId: 'tenant-1',
    amount: '10',
    asset: XLM,
    receiverWallet: TENANT_WALLET,
    publicSlug: publicSlug(opts.slug ?? 'p_8sKd9aBcDeFgHiJkLmNo'),
    externalId: null,
    dueDate: null,
    metadata: opts.metadata,
    now: FIXED,
  });
}

describe('payment-order read use cases', () => {
  it('404s for missing order / status / events', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    await expectAppError(
      new GetPaymentOrder(orders, 'http://x').execute('nope'),
      'ORDER_NOT_FOUND',
      404,
    );
    await expectAppError(
      new GetPaymentOrderStatus(orders, 'http://x').execute('nope'),
      'ORDER_NOT_FOUND',
      404,
    );
    await expectAppError(new GetPaymentOrderEvents(orders).execute('nope'), 'ORDER_NOT_FOUND', 404);
  });

  it('rejects an invalid status filter', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    await expectAppError(
      new ListPaymentOrders(orders, 'http://x').execute({ status: 'BOGUS' }),
      'INVALID_STATUS_FILTER',
      422,
    );
  });

  it('lists with a valid status filter', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    await orders.save(makeOrder());
    const page = await new ListPaymentOrders(orders, 'http://x').execute({ status: 'CREATED' });
    expect(page.total).toBe(1);
  });
});

describe('public payment view', () => {
  it('404s when the order is missing or the tenant is gone', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    const tenants = new InMemoryTenantRepository();
    const uc = new GetPublicPaymentOrder({
      orders,
      tenants,
      network: 'TESTNET',
      explorerBaseUrl: 'http://e',
    });
    await expectAppError(uc.execute('missing'), 'ORDER_NOT_FOUND', 404);

    await orders.save(makeOrder({ slug: 'p_orphanXXXXXXXXXXXXXXX' }));
    await expectAppError(uc.execute('p_orphanXXXXXXXXXXXXXXX'), 'ORDER_NOT_FOUND', 404);
  });

  it('masks documents by type', () => {
    expect(maskDocument('CNPJ', '11222333000181')).not.toContain('11222333');
    expect(maskDocument('CPF', '12345678901')).toMatch(/\*/);
    expect(maskDocument('OTHER', '12')).toBe('****');
    expect(maskDocument('OTHER', '123456789')).toMatch(/6789$/);
  });
});

describe('webhook dispatcher', () => {
  function dispatcher(sender: FakeWebhookSender, deliveries: InMemoryWebhookDeliveryRepository) {
    return new WebhookDispatcher({ deliveries, sender, clock, signingSecret: 'secret' });
  }

  it('returns null when the order has no callback_url', async () => {
    const sender = new FakeWebhookSender();
    const deliveries = new InMemoryWebhookDeliveryRepository();
    const result = await dispatcher(sender, deliveries).dispatch(makeOrder(), 'payment_order.paid');
    expect(result).toBeNull();
    expect(sender.calls).toHaveLength(0);
  });

  it('marks delivered on success', async () => {
    const sender = new FakeWebhookSender({ ok: true, status: 200 });
    const deliveries = new InMemoryWebhookDeliveryRepository();
    const order = makeOrder({ metadata: { callback_url: 'https://erp.example/hook' } });
    const record = await dispatcher(sender, deliveries).dispatch(order, 'payment_order.paid');
    expect(record?.status).toBe('delivered');
    expect(record?.nextRetryAt).toBeNull();
  });

  it('schedules retries on failure and gives up after the backoff schedule', async () => {
    const sender = new FakeWebhookSender({ ok: false, status: 500 });
    const deliveries = new InMemoryWebhookDeliveryRepository();
    const d = dispatcher(sender, deliveries);
    const order = makeOrder({ metadata: { callback_url: 'https://erp.example/hook' } });

    let record = (await d.dispatch(order, 'payment_order.failed'))!;
    expect(record.status).toBe('failed');
    expect(record.nextRetryAt).not.toBeNull();

    let guard = 0;
    while (record.nextRetryAt !== null && guard < 20) {
      record = await d.retry(record, order);
      guard += 1;
    }
    expect(record.nextRetryAt).toBeNull();
    expect(record.attempt).toBe(6);
  });
});

describe('retry-due webhooks sweep', () => {
  it('re-delivers due failed webhooks and skips orphans', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    const deliveries = new InMemoryWebhookDeliveryRepository();
    const order = makeOrder({ metadata: { callback_url: 'https://erp.example/hook' } });
    await orders.save(order);

    const past = new Date(FIXED.getTime() - 60_000);
    await deliveries.create({
      paymentOrderId: order.id,
      eventType: 'payment_order.registered',
      targetUrl: 'https://erp.example/hook',
      attempt: 1,
      status: 'failed',
      nextRetryAt: past,
    });
    await deliveries.create({
      paymentOrderId: 'gone',
      eventType: 'payment_order.registered',
      targetUrl: 'https://erp.example/hook',
      attempt: 1,
      status: 'failed',
      nextRetryAt: past,
    });

    const dispatcher = new WebhookDispatcher({
      deliveries,
      sender: new FakeWebhookSender({ ok: true, status: 200 }),
      clock,
      signingSecret: 'secret',
    });
    const result = await new RetryDueWebhooks({ deliveries, orders, dispatcher, clock }).execute();
    expect(result.processed).toBe(2);
    expect(result.delivered).toBe(1);
  });
});

describe('resend webhook', () => {
  it('409s for an order that has produced no event yet', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    const order = makeOrder({ metadata: { callback_url: 'https://erp.example/hook' } });
    await orders.save(order);
    const d = new WebhookDispatcher({
      deliveries: new InMemoryWebhookDeliveryRepository(),
      sender: new FakeWebhookSender(),
      clock,
      signingSecret: 'secret',
    });
    await expectAppError(new ResendWebhook(orders, d).execute(order.id), 'NO_WEBHOOK_EVENT', 409);
  });

  it('404s for a missing order', async () => {
    const orders = new InMemoryPaymentOrderRepository();
    const d = new WebhookDispatcher({
      deliveries: new InMemoryWebhookDeliveryRepository(),
      sender: new FakeWebhookSender(),
      clock,
      signingSecret: 'secret',
    });
    await expectAppError(new ResendWebhook(orders, d).execute('missing'), 'ORDER_NOT_FOUND', 404);
  });
});

describe('admin login', () => {
  const hasher = new Argon2PasswordHasher();
  const tokens = new HmacJwtService('login-secret');

  it('issues a token for valid credentials', async () => {
    const admins = new InMemoryAdminUserRepository();
    await admins.create({ email: 'a@b.test', passwordHash: await hasher.hash('hunter2') });
    const result = await new LoginAdmin({ admins, hasher, tokens }).execute({
      email: 'a@b.test',
      password: 'hunter2',
    });
    expect(await tokens.verify(result.accessToken)).toMatchObject({ email: 'a@b.test' });
  });

  it('rejects an inactive account as UNAUTHENTICATED', async () => {
    const admins = new InMemoryAdminUserRepository();
    const record: AdminUserRecord = {
      id: 'x',
      email: 'a@b.test',
      passwordHash: await hasher.hash('hunter2'),
      role: 'admin',
      isActive: false,
    };
    admins.byEmail.set(record.email, record);
    await expectAppError(
      new LoginAdmin({ admins, hasher, tokens }).execute({
        email: 'a@b.test',
        password: 'hunter2',
      }),
      'UNAUTHENTICATED',
      401,
    );
  });

  it('validates the input shape', async () => {
    const admins = new InMemoryAdminUserRepository();
    await expectAppError(
      new LoginAdmin({ admins, hasher, tokens }).execute({ email: 'not-an-email' }),
      'INVALID_EMAIL',
      422,
    );
  });
});
