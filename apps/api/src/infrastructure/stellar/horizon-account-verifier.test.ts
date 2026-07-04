import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StellarAccount } from '@payorder/shared';
import { HorizonAccountVerifier } from './horizon-account-verifier.js';
import { RecordingLogger } from '../../../test/fakes.js';

const ACCOUNT: StellarAccount = {
  publicKey: 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ',
  network: 'TESTNET',
};

const verifier = (logger = new RecordingLogger()) =>
  new HorizonAccountVerifier({ horizonUrl: 'https://horizon-testnet.stellar.org/' }, logger);

describe('HorizonAccountVerifier', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns true for a funded account (200) and hits the normalized /accounts URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await verifier().exists(ACCOUNT)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://horizon-testnet.stellar.org/accounts/${ACCOUNT.publicKey}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns false when Horizon reports the account missing (404)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    expect(await verifier().exists(ACCOUNT)).toBe(false);
  });

  it('throws (non-conclusive) on an unexpected status so an outage is never read as "missing"', async () => {
    const logger = new RecordingLogger();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(verifier(logger).exists(ACCOUNT)).rejects.toThrow();
    expect(logger.byLevel('warn').length).toBe(1);
  });

  it('throws when the network is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(verifier().exists(ACCOUNT)).rejects.toThrow('ECONNREFUSED');
  });
});
