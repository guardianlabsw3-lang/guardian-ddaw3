import { Address, Asset as StellarAsset, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { formatStellarAmount, isNativeAsset, onChainRefBytes, type Asset } from '@payorder/shared';
import type { OnChainRef } from '@payorder/shared';

/**
 * Helpers translating between the off-chain domain types and the Soroban host value (`ScVal`)
 * encodings expected by the PayOrder contract (spec 07 §2). Kept separate from the adapter so
 * the (fiddly, exact) encoding can be reasoned about and unit-tested in isolation.
 */

/** Decimal (7-scale) amount string → i128 stroops as a `bigint`. No float arithmetic. */
export function toStroops(amount: string): bigint {
  const normalized = formatStellarAmount(amount); // e.g. "150.0000000"
  const [intPart, fracPart] = normalized.split('.');
  return BigInt(`${intPart}${fracPart}`);
}

/** A 32-byte reference (`BytesN<32>`) ScVal from a derived hex ref. */
export function refToScVal(ref: OnChainRef): xdr.ScVal {
  return nativeToScVal(Buffer.from(onChainRefBytes(ref)), { type: 'bytes' });
}

/** A `BytesN<32>` ScVal from a 64-char hex string (e.g. the canonical-payload hash). */
export function hex32ToScVal(hex: string): xdr.ScVal {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

/** A contract `Symbol` ScVal. */
export function symbolToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'symbol' });
}

/** An `Address` ScVal from a `G...` account or `C...` contract strkey. */
export function addressToScVal(strkey: string): xdr.ScVal {
  return new Address(strkey).toScVal();
}

/**
 * Encode the contract's `AssetInfo` struct (`{ code: Symbol, issuer: Option<Address> }`) as
 * an `ScMap`. Struct fields are encoded as a map keyed by their (sorted) symbol names;
 * `Option::None` is the unit value, matching the soroban-sdk representation.
 */
export function assetToScVal(asset: Asset): xdr.ScVal {
  const issuerVal = asset.issuer === null ? xdr.ScVal.scvVoid() : addressToScVal(asset.issuer);
  return xdr.ScVal.scvMap([
    // "code" sorts before "issuer" — map entries must be in key order.
    new xdr.ScMapEntry({ key: symbolToScVal('code'), val: symbolToScVal(asset.code) }),
    new xdr.ScMapEntry({ key: symbolToScVal('issuer'), val: issuerVal }),
  ]);
}

/**
 * Resolve the Stellar Asset Contract (SAC) address (`C...`) for an asset, deterministically
 * from the network passphrase (spec 07 design note). This is the `token` the contract needs
 * to actually move funds.
 */
export function resolveSacAddress(asset: Asset, networkPassphrase: string): string {
  const stellarAsset = isNativeAsset(asset)
    ? StellarAsset.native()
    : new StellarAsset(asset.code, asset.issuer ?? undefined);
  return stellarAsset.contractId(networkPassphrase);
}
