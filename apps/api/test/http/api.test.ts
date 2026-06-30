import { describe, expect, it } from 'vitest';
import { buildHarness, seedActiveTenant, type TestHarness } from './harness.js';
import { VALID_KEYS } from '../fixtures.js';
import { verifySignatureHeader } from '../../src/infrastructure/webhooks/signer.js';

const WALLET = VALID_KEYS[0];

function adminAuth(h: TestHarness): Record<string, string> {
  return { authorization: `Bearer ${h.adminToken}` };
}

/** Drive an order to ACTIVE on-chain directly on the aggregate (skips the worker). */
async function activateOrder(h: TestHarness, orderId: string): Promise<void> {
  const order = h.orders.byId.get(orderId)!;
  order.markRegisteredOnChain('CCONTRACT123', 'txhash123', new Date());
  await h.orders.save(order);
}

describe('PayOrder REST API (HTTP integration)', () => {
  describe('health & readiness', () => {
    it('reports liveness and readiness', async () => {
      const h = await buildHarness();
      expect((await h.request({ method: 'GET', path: '/health' })).status).toBe(200);
      const ready = await h.request({ method: 'GET', path: '/ready' });
      expect(ready.status).toBe(200);
      expect((ready.body as { checks: Record<string, string> }).checks.database).toBe('up');
    });
  });

  describe('auth', () => {
    it('logs an admin in and rejects bad credentials identically', async () => {
      const h = await buildHarness();
      const ok = await h.request({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: h.adminEmail, password: h.adminPassword },
      });
      expect(ok.status).toBe(200);
      expect((ok.body as { token_type: string }).token_type).toBe('Bearer');

      const bad = await h.request({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: h.adminEmail, password: 'wrong' },
      });
      expect(bad.status).toBe(401);
      expect((bad.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    });

    it('requires authentication and echoes a request id', async () => {
      const h = await buildHarness();
      const res = await h.request({ method: 'GET', path: '/api/tenants' });
      expect(res.status).toBe(401);
      expect(res.headers['x-request-id']).toMatch(/^req_/);
    });

    it('forbids an API key on an admin-only route (403)', async () => {
      const h = await buildHarness();
      const res = await h.request({
        method: 'GET',
        path: '/api/tenants',
        headers: { 'x-api-key': h.apiKey },
      });
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    });

    it('enforces API-key scopes (403 FORBIDDEN_SCOPE)', async () => {
      const h = await buildHarness({ apiKeyScopes: ['orders:read'] });
      const tenantId = await seedActiveTenant(h, WALLET);
      const res = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'k1' },
        body: { tenant_id: tenantId, amount: '10' },
      });
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN_SCOPE');
    });

    it('rejects a malformed/forged bearer token', async () => {
      const h = await buildHarness();
      const res = await h.request({
        method: 'GET',
        path: '/api/tenants',
        headers: { authorization: 'Bearer not.a.jwt' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('tenants (admin)', () => {
    it('creates, reads, lists and audits a tenant', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);

      const got = await h.request({
        method: 'GET',
        path: `/api/tenants/${tenantId}`,
        headers: adminAuth(h),
      });
      expect(got.status).toBe(200);
      expect((got.body as { status: string }).status).toBe('ACTIVE');

      const list = await h.request({
        method: 'GET',
        path: '/api/tenants?status=ACTIVE',
        headers: adminAuth(h),
      });
      expect((list.body as { total: number }).total).toBe(1);

      expect(h.audit.entries.map((e) => e.action)).toContain('tenant.create');
      expect(h.audit.entries.map((e) => e.action)).toContain('tenant.wallet.assign');
    });

    it('blocks a wallet change once an order exists (409)', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'one' },
        body: { tenant_id: tenantId, amount: '10' },
      });
      const res = await h.request({
        method: 'PUT',
        path: `/api/tenants/${tenantId}/wallet`,
        headers: adminAuth(h),
        body: { stellar_wallet_public_key: VALID_KEYS[1], stellar_network: 'TESTNET' },
      });
      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS',
      );
    });

    it('returns 404 for a missing tenant wallet', async () => {
      const h = await buildHarness();
      const created = await h.request({
        method: 'POST',
        path: '/api/tenants',
        headers: adminAuth(h),
        body: {
          name: 'No Wallet',
          legal_name: 'No Wallet LTDA',
          document_type: 'CNPJ',
          document_number: '11222333000181',
          admin_email: 'x@y.test',
          default_asset_code: 'XLM',
          default_asset_issuer: null,
        },
      });
      const id = (created.body as { id: string }).id;
      const res = await h.request({
        method: 'GET',
        path: `/api/tenants/${id}/wallet`,
        headers: adminAuth(h),
      });
      expect(res.status).toBe(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('TENANT_WALLET_NOT_SET');
    });
  });

  describe('payment orders', () => {
    it('creates an order from tenant + amount and returns 202', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const res = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'abc' },
        body: { tenant_id: tenantId, amount: '150.00', external_id: 'ORDER-1' },
      });
      expect(res.status).toBe(202);
      const body = res.body as {
        status: string;
        receiver_wallet_public_key: string;
        public_payment_slug: string;
      };
      expect(body.status).toBe('CREATED');
      expect(body.receiver_wallet_public_key).toBe(WALLET);
      expect(body.public_payment_slug).toMatch(/^p_/);
    });

    it('requires an Idempotency-Key (400)', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const res = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey },
        body: { tenant_id: tenantId, amount: '10' },
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('replays the stored response for the same key and 409s on a divergent body', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const headers = { 'x-api-key': h.apiKey, 'idempotency-key': 'same-key' };
      const first = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers,
        body: { tenant_id: tenantId, amount: '10', external_id: 'E1' },
      });
      const replay = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers,
        body: { tenant_id: tenantId, amount: '10', external_id: 'E1' },
      });
      expect(replay.status).toBe(first.status);
      expect((replay.body as { id: string }).id).toBe((first.body as { id: string }).id);
      expect(replay.headers['idempotent-replayed']).toBe('true');

      const conflict = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers,
        body: { tenant_id: tenantId, amount: '999', external_id: 'E1' },
      });
      expect(conflict.status).toBe(409);
      expect((conflict.body as { error: { code: string } }).error.code).toBe(
        'IDEMPOTENCY_KEY_CONFLICT',
      );
    });

    it('rejects a manually supplied wallet (422)', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const res = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'w' },
        body: { tenant_id: tenantId, amount: '10', stellar_wallet_public_key: VALID_KEYS[1] },
      });
      expect(res.status).toBe(422);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'WALLET_NOT_ALLOWED_ON_ORDER',
      );
    });

    it('lists, gets, and reports status/events', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const created = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'g1' },
        body: { tenant_id: tenantId, amount: '42' },
      });
      const id = (created.body as { id: string }).id;
      await activateOrder(h, id);

      const apiAuth = { 'x-api-key': h.apiKey };
      const list = await h.request({
        method: 'GET',
        path: `/api/payment-orders?tenant_id=${tenantId}`,
        headers: apiAuth,
      });
      expect((list.body as { total: number }).total).toBe(1);

      const status = await h.request({
        method: 'GET',
        path: `/api/payment-orders/${id}/status`,
        headers: apiAuth,
      });
      expect((status.body as { status: string; explorer_url: string }).status).toBe('ACTIVE');
      expect((status.body as { explorer_url: string }).explorer_url).toContain('/contract/');

      const events = await h.request({
        method: 'GET',
        path: `/api/payment-orders/${id}/events`,
        headers: apiAuth,
      });
      const types = (events.body as { items: { event_type: string }[] }).items.map(
        (e) => e.event_type,
      );
      expect(types).toEqual(['created', 'registered']);
    });

    it('cancels an ACTIVE order (admin) and dispatches a webhook', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const created = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'c1' },
        body: { tenant_id: tenantId, amount: '10', callback_url: 'https://erp.example.com/hook' },
      });
      const id = (created.body as { id: string }).id;
      await activateOrder(h, id);

      const res = await h.request({
        method: 'POST',
        path: `/api/payment-orders/${id}/cancel`,
        headers: adminAuth(h),
      });
      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe('CANCELLED');
      expect(h.sender.calls).toHaveLength(1);

      // The dispatched webhook carries a valid HMAC signature over its body.
      const call = h.sender.calls[0]!;
      expect(verifySignatureHeader('webhook-secret-please-ignore', call.body, call.signature)).toBe(
        true,
      );
    });

    it('cannot cancel a non-ACTIVE order (422)', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const created = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'c2' },
        body: { tenant_id: tenantId, amount: '10' },
      });
      const id = (created.body as { id: string }).id;
      const res = await h.request({
        method: 'POST',
        path: `/api/payment-orders/${id}/cancel`,
        headers: adminAuth(h),
      });
      expect(res.status).toBe(422);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('webhooks resend', () => {
    it('resends for an order with a callback_url and 422s without one', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);

      const withTarget = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'r1' },
        body: { tenant_id: tenantId, amount: '10', callback_url: 'https://erp.example.com/hook' },
      });
      const id1 = (withTarget.body as { id: string }).id;
      await activateOrder(h, id1);
      const resend = await h.request({
        method: 'POST',
        path: `/api/payment-orders/${id1}/webhooks/resend`,
        headers: { 'x-api-key': h.apiKey },
      });
      expect(resend.status).toBe(202);
      expect((resend.body as { event_type: string }).event_type).toBe('payment_order.registered');

      const noTarget = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'r2' },
        body: { tenant_id: tenantId, amount: '10', external_id: 'NT' },
      });
      const id2 = (noTarget.body as { id: string }).id;
      await activateOrder(h, id2);
      const fail = await h.request({
        method: 'POST',
        path: `/api/payment-orders/${id2}/webhooks/resend`,
        headers: { 'x-api-key': h.apiKey },
      });
      expect(fail.status).toBe(422);
      expect((fail.body as { error: { code: string } }).error.code).toBe('NO_WEBHOOK_TARGET');
    });
  });

  describe('public query', () => {
    it('exposes only public fields with a masked document', async () => {
      const h = await buildHarness();
      const tenantId = await seedActiveTenant(h, WALLET);
      const created = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'p1' },
        body: { tenant_id: tenantId, amount: '10', metadata: { secret: 'internal' } },
      });
      const slug = (created.body as { public_payment_slug: string }).public_payment_slug;
      const res = await h.request({ method: 'GET', path: `/api/public/payment-orders/${slug}` });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown> & { receiver: { document: string } };
      expect(body.receiver.document).not.toContain('11222333000181');
      expect(body).not.toHaveProperty('metadata');
      expect(body).not.toHaveProperty('adminEmail');
      expect(body.network).toBe('TESTNET');
    });

    it('404s for an unknown slug', async () => {
      const h = await buildHarness();
      const res = await h.request({ method: 'GET', path: '/api/public/payment-orders/p_nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('cross-cutting middleware', () => {
    it('rate limits with 429 and Retry-After', async () => {
      const h = await buildHarness({ rateLimit: 1 });
      await h.request({ method: 'GET', path: '/health' });
      const limited = await h.request({ method: 'GET', path: '/health' });
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect((limited.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    });

    it('answers CORS preflight and reflects an allowlisted origin', async () => {
      const h = await buildHarness();
      const res = await h.request({
        method: 'OPTIONS',
        path: '/api/tenants',
        headers: { origin: 'http://localhost:3001' },
      });
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    });

    it('does not reflect a disallowed origin', async () => {
      const h = await buildHarness();
      const res = await h.request({
        method: 'GET',
        path: '/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('returns 404 for unknown routes and 405 for the wrong method', async () => {
      const h = await buildHarness();
      expect((await h.request({ method: 'GET', path: '/api/nope' })).status).toBe(404);
      expect((await h.request({ method: 'DELETE', path: '/health' })).status).toBe(405);
    });
  });

  describe('API-key tenant allowlist', () => {
    it('forbids creating an order for a tenant outside the allowlist (403)', async () => {
      const h = await buildHarness({ apiKeyTenants: ['some-other-tenant'] });
      const tenantId = await seedActiveTenant(h, WALLET);
      const res = await h.request({
        method: 'POST',
        path: '/api/payment-orders',
        headers: { 'x-api-key': h.apiKey, 'idempotency-key': 'al' },
        body: { tenant_id: tenantId, amount: '10' },
      });
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN_TENANT');
    });
  });
});
