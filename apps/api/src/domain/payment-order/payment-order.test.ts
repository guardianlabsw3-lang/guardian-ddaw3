import { describe, it, expect } from 'vitest';
import { canonicalPayloadHash } from '@payorder/shared';
import { PaymentOrder } from './payment-order.js';
import { canTransition, isTerminal, ORDER_STATUSES } from './order-status.js';
import { normalizeOrderSource } from './order-source.js';
import { DomainError, InvalidStateTransitionError } from '../shared/errors.js';
import {
  TENANT_WALLET,
  publicSlug,
  publicKey,
  XLM,
  USDC,
  expectDomainError,
} from '../../../test/fixtures.js';

const NOW = new Date('2026-06-30T12:00:00Z');

function newOrder(
  overrides: Partial<Parameters<typeof PaymentOrder.create>[0]> = {},
): PaymentOrder {
  return PaymentOrder.create({
    id: 'order-1',
    tenantId: 'tenant-1',
    amount: '150',
    asset: XLM,
    receiverWallet: TENANT_WALLET,
    publicSlug: publicSlug(),
    externalId: 'ORDER-123',
    dueDate: '2026-07-10',
    now: NOW,
    ...overrides,
  });
}

describe('PaymentOrder.create', () => {
  it('starts in CREATED, copies the receiver wallet and computes the canonical hash', () => {
    const order = newOrder();
    expect(order.status).toBe('CREATED');
    expect(order.receiverWallet).toBe(TENANT_WALLET);
    expect(order.amount).toBe('150.0000000');

    const expected = canonicalPayloadHash({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      receiverWallet: TENANT_WALLET,
      amount: '150.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      externalId: 'ORDER-123',
      dueDate: '2026-07-10',
    });
    expect(order.canonicalPayloadHash).toBe(expected);
    expect(order.canonicalPayloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits a single `created` event with the hash', () => {
    const order = newOrder();
    const events = order.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('created');
    expect(events[0]!.payload.canonicalPayloadHash).toBe(order.canonicalPayloadHash);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('defaults source to manual, metadata to {}, nullable fields to null', () => {
    const order = newOrder({ externalId: null, dueDate: null, description: null });
    expect(order.source).toBe('manual');
    expect(order.metadata).toEqual({});
    expect(order.externalId).toBeNull();
    expect(order.dueDate).toBeNull();
    expect(order.sorobanContractId).toBeNull();
    expect(order.paidAt).toBeNull();
  });

  it('normalizes a full ISO due date down to the date component', () => {
    const order = newOrder({ dueDate: '2026-07-10T23:59:59Z' });
    expect(order.dueDate).toBe('2026-07-10');
  });

  it('rejects a zero amount (AMOUNT_MUST_BE_POSITIVE)', () => {
    expectDomainError(() => newOrder({ amount: '0' }), 'AMOUNT_MUST_BE_POSITIVE');
  });

  it('rejects an invalid receiver wallet (INVALID_STELLAR_PUBLIC_KEY)', () => {
    expectDomainError(
      () => newOrder({ receiverWallet: 'NOT-A-KEY' as unknown as typeof TENANT_WALLET }),
      'INVALID_STELLAR_PUBLIC_KEY',
    );
  });

  it('rejects an invalid due date (INVALID_DUE_DATE)', () => {
    expectDomainError(() => newOrder({ dueDate: 'not-a-date' }), 'INVALID_DUE_DATE');
  });

  it('produces a different hash for a different asset (issuer matters)', () => {
    const a = newOrder().canonicalPayloadHash;
    const b = newOrder({ asset: USDC, amount: '150' }).canonicalPayloadHash;
    expect(a).not.toBe(b);
  });
});

describe('PaymentOrder state machine', () => {
  it('CREATED → ACTIVE on registration and records soroban/tx', () => {
    const order = newOrder();
    order.pullEvents();
    order.markRegisteredOnChain('CA_CONTRACT', 'TX_HASH', NOW);
    expect(order.status).toBe('ACTIVE');
    expect(order.sorobanContractId).toBe('CA_CONTRACT');
    expect(order.blockchainTxHash).toBe('TX_HASH');
    expect(order.pullEvents().map((e) => e.type)).toEqual(['registered']);
  });

  it('ACTIVE → PAID is idempotent', () => {
    const order = newOrder();
    order.markRegisteredOnChain('CA', null, NOW);
    order.pullEvents();
    const paidAt = new Date('2026-07-01T00:00:00Z');
    order.markPaid('TX_PAY', paidAt, NOW);
    order.markPaid('TX_PAY', paidAt, NOW); // idempotent, no throw, no extra event
    expect(order.status).toBe('PAID');
    expect(order.paidAt).toBe(paidAt);
    expect(order.pullEvents().map((e) => e.type)).toEqual(['paid']);
  });

  it('ACTIVE → CANCELLED / EXPIRED / FAILED', () => {
    const cancelled = newOrder();
    cancelled.markRegisteredOnChain('CA', null, NOW);
    cancelled.cancel('admin@acme.test', NOW);
    expect(cancelled.status).toBe('CANCELLED');

    const expired = newOrder();
    expired.markRegisteredOnChain('CA', null, NOW);
    expired.expire(NOW);
    expect(expired.status).toBe('EXPIRED');

    const failed = newOrder();
    failed.markRegisteredOnChain('CA', null, NOW);
    failed.markFailed('boom', NOW);
    expect(failed.status).toBe('FAILED');
  });

  it('CREATED → FAILED is allowed (registration failure)', () => {
    const order = newOrder();
    order.markFailed('registration timeout', NOW);
    expect(order.status).toBe('FAILED');
  });

  it('rejects illegal transitions from terminal states', () => {
    const order = newOrder();
    order.markRegisteredOnChain('CA', null, NOW);
    order.cancel('admin', NOW);
    expect(() => order.expire(NOW)).toThrow(InvalidStateTransitionError);
    expectDomainError(
      () => order.markRegisteredOnChain('CA', null, NOW),
      'INVALID_STATE_TRANSITION',
    );
  });

  it('cannot pay or cancel directly from CREATED', () => {
    const order = newOrder();
    expect(() => order.cancel('admin', NOW)).toThrow(InvalidStateTransitionError);
    expect(() => order.markPaid('TX', NOW, NOW)).toThrow(InvalidStateTransitionError);
  });
});

describe('PaymentOrder.assertPayable / isPastDue', () => {
  it('throws ORDER_NOT_PAYABLE unless ACTIVE', () => {
    const order = newOrder();
    expectDomainError(() => order.assertPayable(NOW), 'ORDER_NOT_PAYABLE');
  });

  it('throws ORDER_EXPIRED when past due', () => {
    const order = newOrder({ dueDate: '2026-06-29' });
    order.markRegisteredOnChain('CA', null, NOW);
    expect(order.isPastDue(NOW)).toBe(true);
    expectDomainError(() => order.assertPayable(NOW), 'ORDER_EXPIRED');
  });

  it('is payable when ACTIVE and on/after issue, before due date', () => {
    const order = newOrder({ dueDate: '2026-07-10' });
    order.markRegisteredOnChain('CA', null, NOW);
    expect(order.isPastDue(NOW)).toBe(false);
    expect(() => order.assertPayable(NOW)).not.toThrow();
  });

  it('a null due date never expires', () => {
    const order = newOrder({ dueDate: null });
    order.markRegisteredOnChain('CA', null, NOW);
    expect(order.isPastDue(new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('order-status helpers', () => {
  it('maps transitions and terminality', () => {
    expect(canTransition('CREATED', 'ACTIVE')).toBe(true);
    expect(canTransition('PAID', 'ACTIVE')).toBe(false);
    expect(isTerminal('PAID')).toBe(true);
    expect(isTerminal('ACTIVE')).toBe(false);
    expect(ORDER_STATUSES).toContain('FAILED');
  });
});

describe('order-source normalization', () => {
  it('lowercases known sources and falls back to manual', () => {
    expect(normalizeOrderSource('ERP')).toBe('erp');
    expect(normalizeOrderSource('API')).toBe('api');
    expect(normalizeOrderSource('manual')).toBe('manual');
    expect(normalizeOrderSource(null)).toBe('manual');
    expect(normalizeOrderSource('unknown')).toBe('manual');
  });
});

describe('DomainError code on transitions', () => {
  it('InvalidStateTransitionError exposes from/to details', () => {
    const order = newOrder();
    order.markRegisteredOnChain('CA', null, NOW);
    order.expire(NOW);
    try {
      order.cancel('x', NOW);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('INVALID_STATE_TRANSITION');
      expect((err as DomainError).details).toMatchObject({ from: 'EXPIRED', to: 'CANCELLED' });
    }
  });

  it('publicKey fixture validates', () => {
    expect(publicKey(TENANT_WALLET)).toBe(TENANT_WALLET);
  });
});
