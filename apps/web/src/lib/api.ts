import type {
  ApiErrorBody,
  PaymentOrder,
  PaymentOrderEvent,
  PublicPaymentOrder,
  Tenant,
} from './types';

/**
 * Typed client for the PayOrder REST API (`openapi/payorder-api.yaml`). The public payment
 * endpoint needs no auth; admin endpoints take a Bearer JWT. Errors are normalized to
 * `ApiError` carrying the API's error `code` so the UI can branch on it.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  );
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (isErrorBody(body)) {
      throw new ApiError(res.status, body.error.code, body.error.message);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed with status ${res.status}`);
  }

  return body as T;
}

export class PayOrderApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null = null,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}/api${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  // --- Public (no auth) ---

  async getPublicOrder(slug: string): Promise<PublicPaymentOrder> {
    const res = await fetch(this.url(`/public/payment-orders/${encodeURIComponent(slug)}`), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return parse<PublicPaymentOrder>(res);
  }

  // --- Admin (Bearer JWT) ---

  async login(email: string, password: string): Promise<{ token: string }> {
    const res = await fetch(this.url('/auth/login'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, password }),
    });
    // The API responds with the OpenAPI `LoginResponse` shape (`access_token`); map it to the
    // `token` the admin panel stores and sends as the Bearer credential.
    const body = await parse<{ access_token: string }>(res);
    return { token: body.access_token };
  }

  async listTenants(): Promise<Tenant[]> {
    const res = await fetch(this.url('/tenants'), { headers: this.headers() });
    const body = await parse<Tenant[] | { data: Tenant[] }>(res);
    return Array.isArray(body) ? body : body.data;
  }

  async getTenant(id: string): Promise<Tenant> {
    const res = await fetch(this.url(`/tenants/${id}`), { headers: this.headers() });
    return parse<Tenant>(res);
  }

  async updateTenantWallet(id: string, publicKey: string): Promise<Tenant> {
    const res = await fetch(this.url(`/tenants/${id}/wallet`), {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ stellar_wallet_public_key: publicKey, stellar_network: 'TESTNET' }),
    });
    return parse<Tenant>(res);
  }

  async listOrders(params?: { tenant_id?: string; status?: string }): Promise<PaymentOrder[]> {
    const query = new URLSearchParams();
    if (params?.tenant_id) query.set('tenant_id', params.tenant_id);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    const res = await fetch(this.url(`/payment-orders${qs ? `?${qs}` : ''}`), {
      headers: this.headers(),
    });
    const body = await parse<PaymentOrder[] | { data: PaymentOrder[] }>(res);
    return Array.isArray(body) ? body : body.data;
  }

  async getOrder(id: string): Promise<PaymentOrder> {
    const res = await fetch(this.url(`/payment-orders/${id}`), { headers: this.headers() });
    return parse<PaymentOrder>(res);
  }

  async getOrderEvents(id: string): Promise<PaymentOrderEvent[]> {
    const res = await fetch(this.url(`/payment-orders/${id}/events`), { headers: this.headers() });
    const body = await parse<PaymentOrderEvent[] | { data: PaymentOrderEvent[] }>(res);
    return Array.isArray(body) ? body : body.data;
  }

  /**
   * Create a manual charge from the admin panel. The receiver wallet is **never** sent — the
   * API copies it from the resolved tenant (RN-02). `Idempotency-Key` is required (spec 08 §3.1).
   */
  async createOrder(input: {
    tenant_id: string;
    amount: string;
    asset_code?: string;
    due_date?: string;
    description?: string;
    external_id?: string;
    idempotencyKey: string;
  }): Promise<PaymentOrder> {
    const { idempotencyKey, ...body } = input;
    const res = await fetch(this.url('/payment-orders'), {
      method: 'POST',
      headers: this.headers({ 'Idempotency-Key': idempotencyKey }),
      body: JSON.stringify({ ...body, source: 'manual' }),
    });
    return parse<PaymentOrder>(res);
  }

  async cancelOrder(id: string): Promise<PaymentOrder> {
    const res = await fetch(this.url(`/payment-orders/${id}/cancel`), {
      method: 'POST',
      headers: this.headers(),
    });
    return parse<PaymentOrder>(res);
  }
}
