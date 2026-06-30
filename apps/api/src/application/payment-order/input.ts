import { z } from 'zod';
import {
  AssetCodeSchema,
  SlugSchema,
  StellarPublicKeySchema,
  formatStellarAmount,
} from '@payorder/shared';

/**
 * Input contract for `CreatePaymentOrder` (spec 08 §3.1). Supports all origins
 * (panel/API by `tenantId`/`slug`, ERP by `tenantDocument`). The wallet is **never**
 * accepted here (RN-02) — forbidden keys are rejected before this schema runs.
 */

/**
 * UUID matcher that accepts any version 1–8 (zod's `.uuid()` historically rejects v7, which
 * is what our time-ordered id generator emits — spec 09).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Field names that would (illegally) carry a wallet on the order payload (RN-02). */
export const FORBIDDEN_WALLET_FIELDS = [
  'wallet',
  'receiverWallet',
  'receiver_wallet',
  'receiverWalletPublicKey',
  'receiver_wallet_public_key',
  'walletPublicKey',
  'wallet_public_key',
  'stellarWalletPublicKey',
  'stellar_wallet_public_key',
] as const;

const AmountSchema = z.union([z.string(), z.number()]).superRefine((value, ctx) => {
  let normalized: string;
  try {
    normalized = formatStellarAmount(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_AMOUNT' });
    return;
  }
  if (!/[1-9]/.test(normalized)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AMOUNT_MUST_BE_POSITIVE' });
  }
});

const DueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, { message: 'INVALID_DUE_DATE' })
  .refine((v) => !Number.isNaN(Date.parse(v.slice(0, 10))), { message: 'INVALID_DUE_DATE' });

export const CreatePaymentOrderInputSchema = z
  .object({
    tenantId: z.string().regex(UUID_PATTERN, { message: 'INVALID_TENANT_ID' }).optional(),
    slug: SlugSchema.optional(),
    tenantDocument: z.string().trim().min(1).optional(),

    amount: AmountSchema,
    assetCode: AssetCodeSchema.optional(),
    assetIssuer: StellarPublicKeySchema.nullable().optional(),

    dueDate: DueDateSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    externalId: z.string().trim().min(1).max(64).optional(),
    source: z.string().trim().min(1).optional(),
    callbackUrl: z.string().url().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.tenantId && !input.slug && !input.tenantDocument) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TENANT_REFERENCE_REQUIRED',
        path: ['tenantId'],
      });
    }
  });

export type CreatePaymentOrderInput = z.infer<typeof CreatePaymentOrderInputSchema>;
