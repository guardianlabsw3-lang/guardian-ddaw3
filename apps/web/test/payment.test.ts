import { describe, expect, it } from 'vitest';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { buildPayTransaction } from '../src/stellar/payment';

describe('buildPayTransaction', () => {
  const payer = Keypair.random().publicKey();
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));

  it('builds a single invokeHostFunction operation on Testnet from the payer source', () => {
    const tx = buildPayTransaction({
      contractId,
      payer,
      sequence: '12345',
      orderRefHex: 'a'.repeat(64),
      amount: '150.00',
      asset: { code: 'XLM', issuer: null },
    });

    expect(tx.source).toBe(payer);
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe('invokeHostFunction');
  });

  it('is deterministic for identical inputs (same XDR)', () => {
    const params = {
      contractId,
      payer,
      sequence: '7',
      orderRefHex: 'b'.repeat(64),
      amount: '10.0000000',
      asset: { code: 'XLM', issuer: null },
    } as const;
    expect(buildPayTransaction(params).toXDR()).toBe(buildPayTransaction(params).toXDR());
  });
});
