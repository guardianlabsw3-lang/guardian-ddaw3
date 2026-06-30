import { describe, expect, it } from 'vitest';
import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk';
import { amountToScVal, assetToScVal, payArgs, toStroops } from '../src/stellar/scval';

describe('toStroops', () => {
  it('converts a 7-scale decimal string to i128 stroops', () => {
    expect(toStroops('150.00')).toBe(1_500_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('1')).toBe(10_000_000n);
  });
});

describe('amountToScVal', () => {
  it('encodes an i128 ScVal that decodes back to the stroop bigint', () => {
    const scval = amountToScVal('150.00');
    expect(scValToNative(scval)).toBe(1_500_000_000n);
  });
});

describe('assetToScVal', () => {
  it('encodes native XLM as a map with a void issuer', () => {
    const scval = assetToScVal({ code: 'XLM', issuer: null });
    expect(scval.switch()).toBe(xdr.ScValType.scvMap());
    const entries = scval.map();
    expect(entries).not.toBeNull();
    expect(entries?.length).toBe(2);
  });
});

describe('payArgs', () => {
  it('returns the four positional pay() arguments', () => {
    const payer = Keypair.random().publicKey();
    const orderRefHex = 'a'.repeat(64);
    const args = payArgs(orderRefHex, payer, '150.00', { code: 'XLM', issuer: null });
    expect(args).toHaveLength(4);
    // order_id is a 32-byte BytesN reference.
    expect(args[0]?.switch()).toBe(xdr.ScValType.scvBytes());
    expect(args[0]?.bytes().length).toBe(32);
  });
});
