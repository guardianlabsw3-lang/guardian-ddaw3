import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, PayOrderApi } from '../src/lib/api';

interface FakeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PayOrderApi.getPublicOrder', () => {
  it('calls the public endpoint and returns the parsed body', async () => {
    const order = { status: 'ACTIVE', amount: '150.0000000' };
    fetchMock.mockResolvedValueOnce(jsonResponse(order));

    const api = new PayOrderApi('https://api.test');
    const result = await api.getPublicOrder('p_abc');

    expect(result).toEqual(order);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/public/payment-orders/p_abc');
  });

  it('throws an ApiError carrying the error code on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'TENANT_WALLET_NOT_SET', message: 'no wallet' } }, 409),
    );

    const api = new PayOrderApi('https://api.test');
    await expect(api.getPublicOrder('p_abc')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'TENANT_WALLET_NOT_SET',
    });
  });
});

describe('PayOrderApi.login', () => {
  it('maps the API access_token to the token the panel stores', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'jwt-abc',
        token_type: 'Bearer',
        expires_in: 3600,
        admin: { id: 'a1', email: 'admin@test', role: 'admin' },
      }),
    );

    const api = new PayOrderApi('https://api.test');
    const result = await api.login('admin@test', 'secret');

    expect(result).toEqual({ token: 'jwt-abc' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'admin@test', password: 'secret' });
  });
});

describe('PayOrderApi.listTenants', () => {
  it('unwraps the { items, total } envelope returned by the API', async () => {
    const tenants = [{ id: 'tenant-1' }, { id: 'tenant-2' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: tenants, total: 2 }));

    const api = new PayOrderApi('https://api.test', 'jwt-token');
    const result = await api.listTenants();

    expect(result).toEqual(tenants);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/tenants');
  });
});

describe('PayOrderApi.listOrders', () => {
  it('unwraps the { items, total } envelope returned by the API', async () => {
    const orders = [{ id: 'order-1' }, { id: 'order-2' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: orders, total: 2 }));

    const api = new PayOrderApi('https://api.test', 'jwt-token');
    const result = await api.listOrders();

    expect(result).toEqual(orders);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/payment-orders');
  });
});

describe('PayOrderApi.getOrderEvents', () => {
  it('unwraps the { items } envelope returned by the API', async () => {
    const events = [{ id: 'evt-1' }, { id: 'evt-2' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: events }));

    const api = new PayOrderApi('https://api.test', 'jwt-token');
    const result = await api.getOrderEvents('order-1');

    expect(result).toEqual(events);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/payment-orders/order-1/events');
  });
});

describe('PayOrderApi.createOrder', () => {
  it('sends the Idempotency-Key header and never includes wallet fields (RN-02)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'order-1' }, 202));

    const api = new PayOrderApi('https://api.test', 'jwt-token');
    await api.createOrder({
      tenant_id: 'tenant-1',
      amount: '150.00',
      idempotencyKey: 'idem-123',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/payment-orders');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-123');
    expect(headers.Authorization).toBe('Bearer jwt-token');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ tenant_id: 'tenant-1', amount: '150.00', source: 'manual' });
    for (const key of Object.keys(body)) {
      expect(key.toLowerCase()).not.toContain('wallet');
    }
  });
});

describe('PayOrderApi.updateTenantWallet', () => {
  it('PUTs the wallet with the Testnet network', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'tenant-1' }));

    const api = new PayOrderApi('https://api.test', 'jwt-token');
    await api.updateTenantWallet('tenant-1', 'GBPAYTENANT');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/tenants/tenant-1/wallet');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      stellar_wallet_public_key: 'GBPAYTENANT',
      stellar_network: 'TESTNET',
    });
  });
});

describe('ApiError', () => {
  it('is an Error with status and code', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'missing');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });
});
