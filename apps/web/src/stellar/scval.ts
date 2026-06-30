import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

/**
 * Client-side `ScVal` encoders for the PayOrder Soroban contract. These mirror the API's
 * server-side adapter (`apps/api/src/infrastructure/stellar/scval.ts`) **exactly** so the
 * payer-signed `pay` invocation built in the browser is byte-compatible with what the
 * contract registered at order creation (spec 07 §2/§8).
 *
 * This module is deliberately self-contained (only `@stellar/stellar-sdk`): it must not pull
 * in `@payorder/shared`, whose canonical-hash helper imports `node:crypto` and cannot be
 * bundled for the browser. The on-chain order reference is therefore derived here with Web
 * Crypto (`deriveOrderRefHex`), reproducing the shared `deriveOrderRef` (SHA-256 of the id).
 */

/**
 * Plain asset shape taken from the public order response (`asset_code` + `asset_issuer`).
 * Unlike the shared `Asset` value object, the issuer is an unbranded string.
 */
export interface AssetInput {
  code: string;
  issuer: string | null;
}

const HEX32_PATTERN = /^[0-9a-f]{64}$/i;

/** Convert a 64-char hex string (a 32-byte reference) into raw bytes. */
export function hex32ToBytes(hex: string): Uint8Array {
  if (!HEX32_PATTERN.test(hex)) {
    throw new Error('Invalid 32-byte hex reference');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * SHA-256 hex of a UTF-8 string via Web Crypto — identical to the shared `sha256Hex` used by
 * `deriveOrderRef` (which the API uses to key orders on-chain).
 */
export async function deriveOrderRefHex(orderId: string): Promise<string> {
  const data = new TextEncoder().encode(orderId);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decimal (≤7-scale) amount string → i128 stroops as a `bigint`. No float arithmetic. */
export function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [intPart, fracPart = ''] = trimmed.split('.');
  const frac = `${fracPart}0000000`.slice(0, 7);
  return BigInt(`${intPart}${frac}`);
}

/** A `BytesN<32>` ScVal for the on-chain order reference (64-char hex). */
export function orderRefScVal(orderRefHex: string): xdr.ScVal {
  return nativeToScVal(hex32ToBytes(orderRefHex), { type: 'bytes' });
}

/** A contract `Symbol` ScVal. */
export function symbolToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'symbol' });
}

/** An `Address` ScVal from a `G...` account (or `C...` contract) strkey. */
export function addressToScVal(strkey: string): xdr.ScVal {
  return new Address(strkey).toScVal();
}

/** An `i128` ScVal from a 7-scale decimal amount string. */
export function amountToScVal(amount: string): xdr.ScVal {
  return nativeToScVal(toStroops(amount), { type: 'i128' });
}

/**
 * Encode the contract's `AssetInfo` struct (`{ code: Symbol, issuer: Option<Address> }`) as
 * an `ScMap` with entries in key order — identical to the server adapter.
 */
export function assetToScVal(asset: AssetInput): xdr.ScVal {
  const issuerVal = asset.issuer === null ? xdr.ScVal.scvVoid() : addressToScVal(asset.issuer);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: symbolToScVal('code'), val: symbolToScVal(asset.code) }),
    new xdr.ScMapEntry({ key: symbolToScVal('issuer'), val: issuerVal }),
  ]);
}

/**
 * Positional arguments for the contract `pay(order_id, payer, amount, asset)` method
 * (contract `lib.rs`), in declaration order.
 */
export function payArgs(
  orderRefHex: string,
  payer: string,
  amount: string,
  asset: AssetInput,
): xdr.ScVal[] {
  return [
    orderRefScVal(orderRefHex),
    addressToScVal(payer),
    amountToScVal(amount),
    assetToScVal(asset),
  ];
}
