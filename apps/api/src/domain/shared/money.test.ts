import { describe, it, expect } from 'vitest';
import { Money } from './money.js';
import { DomainError } from './errors.js';
import { XLM, USDC, expectDomainError } from '../../../test/fixtures.js';

describe('Money', () => {
  it('normalizes amounts to Stellar 7-decimal scale', () => {
    expect(Money.of('150', XLM).amount).toBe('150.0000000');
    expect(Money.of('150.5', XLM).amount).toBe('150.5000000');
    expect(Money.of(0.25, XLM).amount).toBe('0.2500000');
  });

  it('rejects non-positive amounts with AMOUNT_MUST_BE_POSITIVE', () => {
    expect(() => Money.of('0', XLM)).toThrow(DomainError);
    expectDomainError(() => Money.of('0.0000000', XLM), 'AMOUNT_MUST_BE_POSITIVE');
  });

  it('rejects invalid amounts and excessive precision with INVALID_AMOUNT', () => {
    expectDomainError(() => Money.of('abc', XLM), 'INVALID_AMOUNT');
    expectDomainError(() => Money.of('-5', XLM), 'INVALID_AMOUNT');
    expectDomainError(() => Money.of('1.00000001', XLM), 'INVALID_AMOUNT');
  });

  it('exposes asset shape and native flag', () => {
    const native = Money.of('1', XLM);
    expect(native.isNative).toBe(true);
    expect(native.assetIssuer).toBeNull();

    const issued = Money.of('1', USDC);
    expect(issued.isNative).toBe(false);
    expect(issued.assetCode).toBe('USDC');
    expect(issued.assetIssuer).not.toBeNull();
  });

  it('compares equality by amount and asset', () => {
    expect(Money.of('1', XLM).equals(Money.of('1.0', XLM))).toBe(true);
    expect(Money.of('1', XLM).equals(Money.of('2', XLM))).toBe(false);
    expect(Money.of('1', XLM).equals(Money.of('1', USDC))).toBe(false);
  });
});

describe('DomainError', () => {
  it('carries a stable code and optional details', () => {
    const err = new DomainError('SOME_CODE', 'boom', { a: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SOME_CODE');
    expect(err.details).toEqual({ a: 1 });
    expect(err.name).toBe('DomainError');
  });
});
