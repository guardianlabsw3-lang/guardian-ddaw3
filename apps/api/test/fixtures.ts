import { expect } from 'vitest';
import { DomainError } from '../src/domain/shared/errors.js';
import { ApplicationError } from '../src/application/shared/errors.js';
import { Tenant } from '../src/domain/tenant/index.js';
import { PaymentOrder } from '../src/domain/payment-order/index.js';
import {
  AssetSchema,
  DocumentSchema,
  EmailSchema,
  SlugSchema,
  StellarAccountSchema,
  StellarPublicKeySchema,
  toStellarPublicKey,
  type Asset,
  type Document,
  type Email,
  type Slug,
  type StellarAccount,
  type StellarPublicKey,
} from '@payorder/shared';

/** Real, checksum-valid ed25519 account public keys (Testnet). */
export const VALID_KEYS = [
  'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
  'GCRYRCRH6YPJVCXNPFVU2CC4QHGISIX4DOIRED4VCNXBAJUW75KRJMGU',
  'GB7BOUQ3MN6PT23V5IQY6EJKD2UFZS3M5W4JVBYO37PTP6U7S626QHG7',
] as const;

export const TENANT_WALLET: StellarPublicKey = toStellarPublicKey(VALID_KEYS[0]);
export const OTHER_WALLET: StellarPublicKey = toStellarPublicKey(VALID_KEYS[1]);
export const ISSUER_KEY: StellarPublicKey = toStellarPublicKey(VALID_KEYS[2]);

export const XLM: Asset = AssetSchema.parse({ code: 'XLM', issuer: null });
export const USDC: Asset = AssetSchema.parse({ code: 'USDC', issuer: VALID_KEYS[2] });

export const VALID_CNPJ = '11222333000181';

export function testnetAccount(publicKey: string = VALID_KEYS[0]): StellarAccount {
  return StellarAccountSchema.parse({ publicKey, network: 'TESTNET' });
}

export function cnpj(number: string = VALID_CNPJ): Document {
  return DocumentSchema.parse({ type: 'CNPJ', number });
}

export function email(value = 'admin@acme.test'): Email {
  return EmailSchema.parse(value);
}

export function slug(value = 'acme-pagamentos'): Slug {
  return SlugSchema.parse(value);
}

export function publicSlug(value = 'p_8sKd9aBcDeFgHiJkLmNo'): Slug {
  return SlugSchema.parse(value);
}

export function publicKey(value: string): StellarPublicKey {
  return StellarPublicKeySchema.parse(value);
}

export const FIXED_NOW = new Date('2026-06-30T12:00:00Z');

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-7000-8000-${seq.toString(16).padStart(12, '0')}`;
}

export interface BuildTenantOptions {
  id?: string;
  slug?: string;
  documentNumber?: string;
  withWallet?: boolean;
  walletKey?: string;
  active?: boolean;
  now?: Date;
}

/** Build a `Tenant` aggregate; by default an ACTIVE tenant with a wallet (can issue orders). */
export function buildTenant(opts: BuildTenantOptions = {}): Tenant {
  const now = opts.now ?? FIXED_NOW;
  const withWallet = opts.withWallet ?? true;
  const tenant = Tenant.create({
    id: opts.id ?? uuid(),
    slug: slug(opts.slug ?? `acme-${(seq += 1)}`),
    name: 'ACME',
    legalName: 'ACME LTDA',
    document: cnpj(opts.documentNumber ?? VALID_CNPJ),
    adminEmail: email(),
    defaultAsset: XLM,
    wallet: withWallet ? testnetAccount(opts.walletKey ?? VALID_KEYS[0]) : null,
    now,
  });
  if ((opts.active ?? true) && withWallet) {
    tenant.activate(now);
  }
  tenant.pullEvents();
  return tenant;
}

export interface BuildOrderOptions {
  id?: string;
  tenantId?: string;
  amount?: string;
  externalId?: string | null;
  dueDate?: string | null;
  receiverWallet?: StellarPublicKey;
  publicSlug?: string;
  now?: Date;
}

/** Build a `PaymentOrder` aggregate in `CREATED` status. */
export function buildOrder(opts: BuildOrderOptions = {}): PaymentOrder {
  return PaymentOrder.create({
    id: opts.id ?? uuid(),
    tenantId: opts.tenantId ?? uuid(),
    amount: opts.amount ?? '150',
    asset: XLM,
    receiverWallet: opts.receiverWallet ?? TENANT_WALLET,
    publicSlug: publicSlug(opts.publicSlug ?? `p_${uuid().replace(/-/g, '').slice(-22)}`),
    externalId: opts.externalId ?? null,
    dueDate: opts.dueDate ?? null,
    now: opts.now ?? FIXED_NOW,
  });
}

/**
 * Assert that `fn` throws a `DomainError` with the given stable code, and return it for
 * further assertions. Domain errors carry the code separately from the message, so we
 * match on `.code` rather than on the message text.
 */
export function expectDomainError(fn: () => unknown, code: string): DomainError {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `expected a DomainError(${code}) to be thrown`).toBeInstanceOf(DomainError);
  const domainError = thrown as DomainError;
  expect(domainError.code).toBe(code);
  return domainError;
}

/**
 * Await `promise` and assert it rejects with an `ApplicationError` of the given code (and
 * optional HTTP status). Returns the error for further assertions.
 */
export async function expectAppError(
  promise: Promise<unknown>,
  code: string,
  status?: number,
): Promise<ApplicationError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `expected an ApplicationError(${code}) to be thrown`).toBeInstanceOf(
    ApplicationError,
  );
  const appError = thrown as ApplicationError;
  expect(appError.code).toBe(code);
  if (status !== undefined) {
    expect(appError.status).toBe(status);
  }
  return appError;
}
