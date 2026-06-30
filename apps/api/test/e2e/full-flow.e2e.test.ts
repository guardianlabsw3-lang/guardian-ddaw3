import { describe, expect, it } from 'vitest';
import { buildE2EHarness, onboardTenant, type E2EHarness } from './harness.js';
import { VALID_KEYS } from '../fixtures.js';

/**
 * TASK-030 — the mandatory end-to-end flow (spec 11 §8). One test walks the nine documented
 * steps across the real HTTP API and the worker use cases: create tenant → assign wallet →
 * create an order from **tenant + amount only** → the system resolves the destination wallet →
 * query the public link → register on-chain → confirm the payment → reconcile to `PAID` →
 * prove a duplicate payment is blocked. The on-chain authority is a scripted mock; everything
 * else is the production wiring.
 */

const TENANT_WALLET = VALID_KEYS[0];
const PAYER = VALID_KEYS[1];

function apiKeyAuth(h: E2EHarness): Record<string, string> {
  return { 'x-api-key': h.apiKey };
}

describe('E2E — full payment lifecycle (spec 11 §8)', () => {
  it('walks all nine steps from onboarding to a reconciled, duplicate-proof payment', async () => {
    const h = await buildE2EHarness();

    // Steps 1–2: create the tenant and register its Stellar Testnet wallet.
    const { tenantId } = await onboardTenant(h, TENANT_WALLET);
    const tenant = await h.request({
      method: 'GET',
      path: `/api/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${h.adminToken}` },
    });
    expect(tenant.status).toBe(200);
    expect((tenant.body as { status: string }).status).toBe('ACTIVE');

    // Step 3: create a payment order informing ONLY the tenant and the amount.
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'e2e-order-1' },
      body: { tenant_id: tenantId, amount: '150.00', external_id: 'INV-001' },
    });
    expect(created.status).toBe(202);
    const order = created.body as {
      id: string;
      status: string;
      receiver_wallet_public_key: string;
      public_payment_slug: string;
      canonical_payload_hash: string;
    };
    expect(order.status).toBe('CREATED');

    // Step 4: the system resolved the destination wallet from the tenant — never supplied by
    // the caller (RN-02/RN-03).
    expect(order.receiver_wallet_public_key).toBe(TENANT_WALLET);
    expect(order.public_payment_slug).toMatch(/^p_/);

    // The order is registered on-chain by the worker (CREATED → ACTIVE).
    const jobs = await h.processRegistrations();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.paymentOrderId).toBe(order.id);

    // Step 5: consult the public link — only non-sensitive fields, destination wallet visible.
    const publicView = await h.request({
      method: 'GET',
      path: `/api/public/payment-orders/${order.public_payment_slug}`,
    });
    expect(publicView.status).toBe(200);
    const pub = publicView.body as {
      status: string;
      network: string;
      receiver: { wallet_public_key: string };
      canonical_payload_hash: string;
      soroban_contract_id: string | null;
    };
    expect(pub.status).toBe('ACTIVE');
    expect(pub.network).toBe('TESTNET');
    expect(pub.receiver.wallet_public_key).toBe(TENANT_WALLET);
    // The hash the payer signs over matches the one fixed at creation (RN-04, immutable).
    expect(pub.canonical_payload_hash).toBe(order.canonical_payload_hash);
    expect(pub.soroban_contract_id).not.toBeNull();

    // Steps 6–7: the payer connects a wallet and pays on-chain (modelled by the contract now
    // reporting the order PAID by the payer account).
    const paidAt = new Date('2026-06-30T12:05:00Z');
    h.confirmOnChainPayment(order.id, PAYER, paidAt);

    // Step 8: reconciliation reflects the on-chain PAID state off-chain.
    const synced = await h.syncOrder(order.id);
    expect(synced).toEqual({ outcome: 'updated', onChainStatus: 'PAID' });

    const status = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${order.id}/status`,
      headers: apiKeyAuth(h),
    });
    expect((status.body as { status: string }).status).toBe('PAID');

    const events = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${order.id}/events`,
      headers: apiKeyAuth(h),
    });
    const eventTypes = (events.body as { items: { event_type: string }[] }).items.map(
      (e) => e.event_type,
    );
    expect(eventTypes).toEqual(['created', 'registered', 'paid']);

    // Step 9: a duplicate payment is impossible. Re-confirming and re-syncing is a no-op, the
    // status stays PAID, and exactly one `paid` event was ever recorded.
    h.confirmOnChainPayment(order.id, PAYER, new Date('2026-06-30T12:10:00Z'));
    const resync = await h.syncOrder(order.id);
    expect(resync.outcome).toBe('in-sync');
    expect(resync.onChainStatus).toBe('PAID');

    const finalEvents = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${order.id}/events`,
      headers: apiKeyAuth(h),
    });
    const paidEvents = (finalEvents.body as { items: { event_type: string }[] }).items.filter(
      (e) => e.event_type === 'paid',
    );
    expect(paidEvents).toHaveLength(1);
  });

  it('resolves the destination wallet when the order is created by tenant document (step 4)', async () => {
    const h = await buildE2EHarness();
    const { documentNumber } = await onboardTenant(h, TENANT_WALLET, '11444777000161');

    // The ERP integration knows only the merchant's CNPJ — the wallet is resolved server-side.
    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'by-doc' },
      body: { tenant_document: documentNumber, amount: '42.0000000' },
    });
    expect(created.status).toBe(202);
    expect(
      (created.body as { receiver_wallet_public_key: string }).receiver_wallet_public_key,
    ).toBe(TENANT_WALLET);
  });

  it('marks a registered order EXPIRED once its due date passes (lifecycle branch)', async () => {
    const h = await buildE2EHarness();
    const { tenantId } = await onboardTenant(h, TENANT_WALLET);

    const created = await h.request({
      method: 'POST',
      path: '/api/payment-orders',
      headers: { ...apiKeyAuth(h), 'idempotency-key': 'exp-1' },
      body: { tenant_id: tenantId, amount: '10', due_date: '2026-07-01' },
    });
    const id = (created.body as { id: string }).id;
    await h.processRegistrations();

    // Before the due date nothing expires.
    expect((await h.expireDueOrders()).expired).toBe(0);

    // Advance the clock past the due date; the expiration worker transitions it.
    h.clock.set(new Date('2026-07-02T00:00:00Z'));
    const result = await h.expireDueOrders();
    expect(result.expired).toBe(1);

    const status = await h.request({
      method: 'GET',
      path: `/api/payment-orders/${id}/status`,
      headers: apiKeyAuth(h),
    });
    expect((status.body as { status: string }).status).toBe('EXPIRED');
  });
});
