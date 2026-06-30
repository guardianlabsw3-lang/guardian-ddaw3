import { describe, it, expect } from 'vitest';
import { loadConfig, EnvValidationError, TESTNET_PASSPHRASE, MAINNET_PASSPHRASE } from './env.js';

const BASE = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  PUBLIC_WEB_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgres://payorder:payorder@localhost:5432/payorder',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'change-me-local',
  WEBHOOK_SIGNING_SECRET: 'change-me-local',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('loads a valid Testnet environment with sane defaults', () => {
    const config = loadConfig(BASE);
    expect(config.stellar.network).toBe('TESTNET');
    expect(config.stellar.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(config.api.port).toBe(3000);
    expect(config.stellar.horizonUrl).toContain('testnet');
    expect(config.stellar.sorobanContractId).toBeNull();
    expect(config.registerOnChainSync).toBe(false);
    expect(config.api.corsOrigins).toEqual([]);
  });

  it('parses CORS origins and a numeric port', () => {
    const config = loadConfig({
      ...BASE,
      API_PORT: '8080',
      CORS_ORIGINS: 'http://localhost:3001, https://admin.example , ',
    });
    expect(config.api.port).toBe(8080);
    expect(config.api.corsOrigins).toEqual(['http://localhost:3001', 'https://admin.example']);
  });

  it('coerces REGISTER_ON_CHAIN_SYNC from string', () => {
    expect(loadConfig({ ...BASE, REGISTER_ON_CHAIN_SYNC: 'true' }).registerOnChainSync).toBe(true);
    expect(loadConfig({ ...BASE, REGISTER_ON_CHAIN_SYNC: '1' }).registerOnChainSync).toBe(true);
    expect(loadConfig({ ...BASE, REGISTER_ON_CHAIN_SYNC: 'false' }).registerOnChainSync).toBe(
      false,
    );
  });

  it('rejects a non-Testnet network (UNSUPPORTED_NETWORK)', () => {
    expect(() => loadConfig({ ...BASE, STELLAR_NETWORK: 'PUBLIC' })).toThrow(EnvValidationError);
    try {
      loadConfig({ ...BASE, STELLAR_NETWORK: 'MAINNET' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issues = (err as EnvValidationError).issues;
      expect(issues.some((i) => i.path === 'STELLAR_NETWORK')).toBe(true);
    }
  });

  it('rejects the Mainnet passphrase even if the network field is omitted', () => {
    try {
      loadConfig({ ...BASE, STELLAR_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issue = (err as EnvValidationError).issues.find(
        (i) => i.path === 'STELLAR_NETWORK_PASSPHRASE',
      );
      expect(issue?.message).toMatch(/UNSUPPORTED_NETWORK/);
    }
  });

  it('fails fast with aggregated issues on missing required vars', () => {
    try {
      loadConfig({ NODE_ENV: 'production' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const paths = (err as EnvValidationError).issues.map((i) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining(['APP_BASE_URL', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET']),
      );
    }
  });

  it('rejects malformed DATABASE_URL / REDIS_URL', () => {
    expect(() => loadConfig({ ...BASE, DATABASE_URL: 'mysql://x' })).toThrow(EnvValidationError);
    expect(() => loadConfig({ ...BASE, REDIS_URL: 'http://x' })).toThrow(EnvValidationError);
  });

  it('rejects a too-short JWT secret', () => {
    expect(() => loadConfig({ ...BASE, JWT_SECRET: 'short' })).toThrow(EnvValidationError);
  });
});
