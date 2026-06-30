/**
 * Wire shapes for the PayOrder REST API. Field casing mirrors the OpenAPI contract
 * (`openapi/payorder-api.yaml`, snake_case) so responses are consumed as-is.
 */

export type OrderStatus = 'CREATED' | 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

/** Public, non-sensitive view served at `GET /api/public/payment-orders/{slug}` (spec 08 §3.2). */
export interface PublicPaymentOrder {
  status: OrderStatus;
  network: 'TESTNET';
  receiver: {
    name: string;
    document: string | null;
    wallet_public_key: string;
  };
  amount: string;
  asset_code: string;
  asset_issuer: string | null;
  due_date: string | null;
  order_id: string;
  canonical_payload_hash: string;
  soroban_contract_id: string | null;
  explorer_url: string | null;
}

/** Admin view of a tenant (spec 08 §2 / OpenAPI `Tenant`). */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  legal_name: string;
  document_type: string;
  document_number: string;
  admin_email: string;
  stellar_wallet_public_key: string | null;
  stellar_network: 'TESTNET';
  default_asset_code: string;
  default_asset_issuer: string | null;
  status: 'ACTIVE' | 'INACTIVE' | string;
  created_at: string;
  updated_at: string;
}

/** Admin view of a payment order (spec 08 §3.1 / OpenAPI `PaymentOrder`). */
export interface PaymentOrder {
  id: string;
  tenant_id: string;
  external_id: string | null;
  amount: string;
  asset_code: string;
  asset_issuer: string | null;
  receiver_wallet_public_key: string;
  canonical_payload_hash: string;
  status: OrderStatus;
  source: string;
  due_date: string | null;
  description: string | null;
  public_payment_slug: string;
  public_payment_url: string;
  soroban_contract_id: string | null;
  blockchain_transaction_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

export interface PaymentOrderEvent {
  id: string;
  payment_order_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Paginated<T> {
  items: T[];
  total?: number;
}

/** Standard API error envelope (spec 08 §1). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}
