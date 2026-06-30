import { describe, it, expect } from 'vitest';
import { isValidCpf, isValidCnpj, DocumentSchema } from './document.js';
import { AssetSchema, isNativeAsset } from './asset.js';
import { EmailSchema, SlugSchema } from './common.js';
import { CreateTenantInputSchema, TenantStatusSchema } from './tenant.js';

const VALID_PUBLIC_KEY = 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ';
const VALID_ISSUER = 'GCRYRCRH6YPJVCXNPFVU2CC4QHGISIX4DOIRED4VCNXBAJUW75KRJMGU';

describe('Document', () => {
  it('validates known-good CPF and CNPJ check digits', () => {
    expect(isValidCpf('11144477735')).toBe(true);
    expect(isValidCpf('111.444.777-35')).toBe(true); // formatting is stripped
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejects invalid check digits and repeated-digit documents', () => {
    expect(isValidCpf('11144477700')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
    expect(isValidCnpj('11222333000100')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('DocumentSchema fails with INVALID_DOCUMENT for a bad number', () => {
    const result = DocumentSchema.safeParse({ type: 'CPF', number: '12345678900' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('INVALID_DOCUMENT');
    }
  });

  it('OTHER accepts any non-empty value', () => {
    expect(DocumentSchema.safeParse({ type: 'OTHER', number: 'X-123' }).success).toBe(true);
    expect(DocumentSchema.safeParse({ type: 'OTHER', number: '' }).success).toBe(false);
  });
});

describe('Asset', () => {
  it('accepts native XLM with a null issuer', () => {
    const asset = AssetSchema.parse({ code: 'XLM', issuer: null });
    expect(isNativeAsset(asset)).toBe(true);
  });

  it('defaults a missing issuer to null', () => {
    const asset = AssetSchema.parse({ code: 'XLM' });
    expect(asset.issuer).toBeNull();
  });

  it('requires an issuer for non-native assets (ASSET_ISSUER_REQUIRED)', () => {
    const result = AssetSchema.safeParse({ code: 'USDC', issuer: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('ASSET_ISSUER_REQUIRED');
    }
  });

  it('accepts an issued asset with a valid issuer', () => {
    expect(AssetSchema.safeParse({ code: 'USDC', issuer: VALID_ISSUER }).success).toBe(true);
  });

  it('rejects native XLM that carries an issuer', () => {
    expect(AssetSchema.safeParse({ code: 'XLM', issuer: VALID_ISSUER }).success).toBe(false);
  });

  it('rejects malformed asset codes', () => {
    expect(AssetSchema.safeParse({ code: '', issuer: null }).success).toBe(false);
    expect(AssetSchema.safeParse({ code: 'TOOLONGASSET123', issuer: VALID_ISSUER }).success).toBe(
      false,
    );
  });
});

describe('Email / Slug', () => {
  it('validates email format', () => {
    expect(EmailSchema.safeParse('admin@guardian.io').success).toBe(true);
    const bad = EmailSchema.safeParse('not-an-email');
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe('INVALID_EMAIL');
    }
  });

  it('validates slug format', () => {
    expect(SlugSchema.safeParse('acme-corp').success).toBe(true);
    expect(SlugSchema.safeParse('-bad-').success).toBe(false);
    expect(SlugSchema.safeParse('white space').success).toBe(false);
  });
});

describe('CreateTenantInput', () => {
  const base = {
    name: 'Acme',
    legalName: 'Acme S.A.',
    document: { type: 'CNPJ', number: '11222333000181' },
    adminEmail: 'admin@acme.io',
    defaultAsset: { code: 'XLM', issuer: null },
  };

  it('accepts a valid tenant without a wallet (wallet optional at creation)', () => {
    expect(CreateTenantInputSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a valid tenant with a Testnet wallet', () => {
    const result = CreateTenantInputSchema.safeParse({
      ...base,
      wallet: { publicKey: VALID_PUBLIC_KEY, network: 'TESTNET' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid document', () => {
    expect(
      CreateTenantInputSchema.safeParse({
        ...base,
        document: { type: 'CNPJ', number: '11111111111111' },
      }).success,
    ).toBe(false);
  });

  it('rejects a non-native default asset without an issuer', () => {
    expect(
      CreateTenantInputSchema.safeParse({
        ...base,
        defaultAsset: { code: 'USDC', issuer: null },
      }).success,
    ).toBe(false);
  });

  it('rejects a wallet on a non-Testnet network', () => {
    expect(
      CreateTenantInputSchema.safeParse({
        ...base,
        wallet: { publicKey: VALID_PUBLIC_KEY, network: 'MAINNET' },
      }).success,
    ).toBe(false);
  });

  it('TenantStatus enum', () => {
    expect(TenantStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(TenantStatusSchema.safeParse('PENDING').success).toBe(false);
  });
});
