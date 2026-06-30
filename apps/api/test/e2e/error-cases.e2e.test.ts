import { describe, expect, it } from 'vitest';
import { buildE2EHarness, onboardTenant, type E2EHarness } from './harness.js';
import { VALID_KEYS } from '../fixtures.js';

/**
 * TASK-030 — the mandatory error matrix (spec 11 §9). Each test maps to one bullet of the
 * spec's list, exercised through the production HTTP edge and worker use cases over the
 * full-stack E2E harness. On-chain payment validations (divergent amount/asset, double-pay)
 * are owned and tested by the Soroban contract (`contracts/payorder/src/test.rs`, spec 07 §8);
 * here we cover the off-chain integrity guards that make those divergences unrepresentable —
 * the receiver wallet, amount, asset and canonical hash are server-derived and immutable.
 */

const WALLET = VALID_KEYS[0];
const OTHER_WALLET = VALID_KEYS[1];

function adminAuth(h: E2EHarness): Record<string, string> {
  return { authorization: `Bearer ${h.adminToken}` };
}
function apiKeyAuth(h: E2EHarness): Record<string, string> {
  return { 'x-api-key': h.apiKey };
}
function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}

describe('E2E — error matrix (spec 11 §9)', () => {
  it('§9 nonexistent tenant: creating an order for an unknown tenant_id → 404', async () => {
    const h = await buildE2EHarness();
    const res = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'k' },
      body: { tenant_id: '00000000-0000-7000-8000-000000000000', amount: '10' },
    });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('TENANT_NOT_FOUND');
  });

  it('§9 CNPJ with no tenant: resolving by an unbound document → 404', async () => {
    const h = await buildE2EHarness();
    const res = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'k' },
      body: { tenant_document: '11444777000161', amount: '10' },
    });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('TENANT_NOT_FOUND');
  });

  it('§9 tenant without wallet: ordering for a wallet-less tenant → 409', async () => {
    const h = await buildE2EHarness();
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
    const tenantId = (created.body as { id: string }).id;
    // A tenant cannot be activated without a wallet, so it is INACTIVE; ordering is rejected.
    const res = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'k' },
      body: { tenant_id: tenantId, amount: '10' },
    });
    expect(res.status).toBe(409);
    expect(['TENANT_WALLET_NOT_SET', 'TENANT_INACTIVE']).toContain(errorCode(res));
  });

  it('§9 invalid tenant wallet: assigning a malformed public key is rejected', async () => {
    const h = await buildE2EHarness();
    const created = await h.request({
      method: 'POST',
      path: '/api/tenants',
      headers: adminAuth(h),
      body: {
        name: 'Bad Wallet',
        legal_name: 'Bad Wallet LTDA',
        document_type: 'CNPJ',
        document_number: '11222333000181',
        admin_email: 'x@y.test',
        default_asset_code: 'XLM',
        default_asset_issuer: null,
      },
    });
    const tenantId = (created.body as { id: string }).id;
    const res = await h.request({
      method: 'PUT',
      path: `/api/tenants/${tenantId}/wallet`,
      headers: adminAuth(h),
      body: { stellar_wallet_public_key: 'GINVALIDKEY', stellar_network: 'TESTNET' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('§9 nonexistent order: status of an unknown id → 404, public unknown slug → 404', async () => {
    const h = await buildE2EHarness();
    const byId = await h.request({
      method: 'GET',
      path: '/api/payment-orders/00000000-0000-7000-8000-0000000000ff/status',
      headers: apiKeyAuth(h),
    });
    expect(byId.status).toBe(404);

    const bySlug = await h.request({
      method: 'GET',
      path: '/api/public/payment-orders/p_does_not_exist',
    });
    expect(bySlug.status).toBe(404);
  });

  it('§9 expired order: a past-due order is not payable and reconciles to EXPIRED', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'exp' },
      body: { tenant_id: tenantId, amount: '10', due_date: '2026-07-01' },
    });
    const id = (created.body as { id: string }).id;
    await h.processRegistrations();

    h.clock.set(new Date('2026-07-02T00:00:00Z'));
    expect((await h.expireDueOrders()).expired).toBe(1);

    const status = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${id}/status`,
      headers: apiKeyAuth(h),
    });
    expect((status.body as { status: string }).status).toBe('EXPIRED');
  });

  it('§9 divergent amount/asset/hash: the signed payload is server-fixed and immutable', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'imm' },
      body: { tenant_id: tenantId, amount: '150.00' },
    });
    const order = created.body as {
      amount: string;
      asset_code: string;
      receiver_wallet_public_key: string;
      canonical_payload_hash: string;
      public_payment_slug: string;
    };
    await h.processRegistrations();

    // The public view a payer signs over carries exactly the values fixed at creation — the
    // contract rejects any pay whose amount/asset/hash diverges from this (spec 07 §8).
    const pub = await h.request({
      method: 'GET',
      path: `/api/public/payment-orders/${order.public_payment_slug}`,
    });
    const view = pub.body as {
      amount: string;
      asset_code: string;
      receiver: { wallet_public_key: string };
      canonical_payload_hash: string;
    };
    expect(view.amount).toBe(order.amount);
    expect(view.asset_code).toBe(order.asset_code);
    expect(view.receiver.wallet_public_key).toBe(order.receiver_wallet_public_key);
    expect(view.canonical_payload_hash).toBe(order.canonical_payload_hash);
    // The amount the merchant set is XLM-scale normalised (7 decimals) and tamper-evident.
    expect(view.canonical_payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('§9 pay an already-paid order: reconciliation is idempotent (no double payment)', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'dbl' },
      body: { tenant_id: tenantId, amount: '10' },
    });
    const id = (created.body as { id: string }).id;
    await h.processRegistrations();

    h.confirmOnChainPayment(id, OTHER_WALLET);
    expect((await h.syncOrder(id)).outcome).toBe('updated');
    // A second confirmation/sync changes nothing — the order is already terminal-PAID.
    expect((await h.syncOrder(id)).outcome).toBe('in-sync');

    const events = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${id}/events`,
      headers: apiKeyAuth(h),
    });
    const paid = (events.body as { items: { event_type: string }[] }).items.filter(
      (e) => e.event_type === 'paid',
    );
    expect(paid).toHaveLength(1);
  });

  it('§9 cancel a paid order: cancelling a PAID order → 422 invalid transition', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'cxl' },
      body: { tenant_id: tenantId, amount: '10' },
    });
    const id = (created.body as { id: string }).id;
    await h.processRegistrations();
    h.confirmOnChainPayment(id, OTHER_WALLET);
    await h.syncOrder(id);

    const res = await h.request({
      method: 'POST',
      path: `/api/payment-orders/${id}/cancel`,
      headers: adminAuth(h),
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('INVALID_STATE_TRANSITION');
  });

  it('§9 duplicate order: a repeat (tenant, external_id) returns the same order, not a new one', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const headers = { ...apiKeyAuth(h), 'idempotency-key': 'dup-key' };
    const body = { tenant_id: tenantId, amount: '10', external_id: 'DUP-1' };

    const first = await h.request({ method: 'POST', path: '/api/payment-orders', headers, body });
    const second = await h.request({ method: 'POST', path: '/api/payment-orders', headers, body });

    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
    // Exactly one order exists for the tenant.
    const list = await h.request({
      method: 'GET',
      path: `/api/payment-orders?tenant_id=${tenantId}`,
      headers: apiKeyAuth(h),
    });
    expect((list.body as { total: number }).total).toBe(1);
  });

  it('§9 unauthenticated integration: no API key / no token → 401', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const noKey = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { 'idempotency-key': 'k' },
      body: { tenant_id: tenantId, amount: '10' },
    });
    expect(noKey.status).toBe(401);

    const noToken = await h.request({ method: 'GET', path: '/api/tenants' });
    expect(noToken.status).toBe(401);
  });

  it('§9 manual wallet on a charge: supplying a wallet on the order → 422', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    const res = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'man' },
      body: { tenant_id: tenantId, amount: '10', stellar_wallet_public_key: OTHER_WALLET },
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('WALLET_NOT_ALLOWED_ON_ORDER');
  });

  it('§9 change wallet with an active order: blocked → 409', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, WALLET);
    await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'act' },
      body: { tenant_id: tenantId, amount: '10' },
    });
    await h.processRegistrations();

    const res = await h.request({
      method: 'PUT',
      path: `/api/tenants/${tenantId}/wallet`,
      headers: adminAuth(h),
      body: { stellar_wallet_public_key: OTHER_WALLET, stellar_network: 'TESTNET' },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS');
  });
});
