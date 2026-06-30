import { describe, it, expect } from 'vitest';
import { scValToNative } from '@stellar/stellar-sdk';
import { AssetSchema } from '@payorder/shared';
import { TESTNET_PASSPHRASE } from '../config/env.js';
import { assetToScVal, resolveSacAddress, toStroops } from './scval.js';

const XLM = AssetSchema.parse({ code: 'XLM', issuer: null });
const USDC = AssetSchema.parse({
  code: 'USDC',
  issuer: 'GCRYRCRH6YPJVCXNPFVU2CC4QHGISIX4DOIRED4VCNXBAJUW75KRJMGU',
});

describe('toStroops', () => {
  it('scales a decimal amount to i128 stroops without float math', () => {
    expect(toStroops('150')).toBe(1500000000n);
    expect(toStroops('150.00')).toBe(1500000000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('0')).toBe(0n);
  });
});

describe('assetToScVal', () => {
  it('encodes native XLM with a void issuer', () => {
    const decoded = scValToNative(assetToScVal(XLM));
    expect(decoded.code).toBe('XLM');
    expect(decoded.issuer == null).toBe(true);
  });

  it('encodes an issued asset with its issuer address', () => {
    const decoded = scValToNative(assetToScVal(USDC));
    expect(decoded.code).toBe('USDC');
    expect(decoded.issuer).toBe(USDC.issuer);
  });
});

describe('resolveSacAddress', () => {
  it('deterministically resolves the native SAC address (C...)', () => {
    const a = resolveSacAddress(XLM, TESTNET_PASSPHRASE);
    const b = resolveSacAddress(XLM, TESTNET_PASSPHRASE);
    expect(a).toBe(b);
    expect(a.startsWith('C')).toBe(true);
  });

  it('resolves a different SAC for an issued asset', () => {
    expect(resolveSacAddress(USDC, TESTNET_PASSPHRASE)).not.toBe(
      resolveSacAddress(XLM, TESTNET_PASSPHRASE),
    );
  });
});
