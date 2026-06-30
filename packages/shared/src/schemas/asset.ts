import { z } from 'zod';
import { StellarPublicKeySchema } from '../stellar/public-key.js';

/**
 * `Asset` value object: `{ code, issuer? }`. Native XLM has a null issuer; any other
 * (issued) asset requires a valid issuer public key. See spec 03 §4 and 05 §4.
 */

export const NATIVE_ASSET_CODE = 'XLM';

/** Asset code: 1–12 alphanumeric characters (Stellar limit). */
export const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

export const AssetCodeSchema = z
  .string()
  .regex(ASSET_CODE_PATTERN, { message: 'INVALID_ASSET_CODE' });

export const AssetSchema = z
  .object({
    code: AssetCodeSchema,
    // Issuer is the asset issuer's account public key, or null for native XLM.
    issuer: StellarPublicKeySchema.nullable().default(null),
  })
  .superRefine((asset, ctx) => {
    if (asset.code === NATIVE_ASSET_CODE) {
      if (asset.issuer !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NATIVE_ASSET_MUST_NOT_HAVE_ISSUER',
          path: ['issuer'],
        });
      }
      return;
    }
    if (asset.issuer === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ASSET_ISSUER_REQUIRED',
        path: ['issuer'],
      });
    }
  });

export type Asset = z.infer<typeof AssetSchema>;

export function isNativeAsset(asset: Pick<Asset, 'code' | 'issuer'>): boolean {
  return asset.code === NATIVE_ASSET_CODE && asset.issuer === null;
}
