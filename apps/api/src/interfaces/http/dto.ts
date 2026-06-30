import type { LoginResult } from '../../application/auth/index.js';
import type {
  PaymentOrderEventView,
  PaymentOrderStatusView,
  PaymentOrderView,
  PublicPaymentOrderView,
} from '../../application/payment-order/index.js';
import type { TenantView, TenantWalletView } from '../../application/tenant/index.js';

/**
 * HTTP DTO mapping (spec 08). The API wire format is **snake_case** (spec 08 examples); the
 * domain/use cases are camelCase. These functions translate request bodies into use-case
 * inputs and serialize use-case views into the documented response shapes — keeping the
 * OpenAPI contract and the backend in lock-step (TASK-024) without leaking internal naming.
 */

type Body = Record<string, unknown>;

function asObject(value: unknown): Body {
  return value && typeof value === 'object' ? (value as Body) : {};
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

/** Map a snake_case create-tenant body to `CreateTenantInputSchema` (shared, camelCase). */
export function toCreateTenantInput(rawBody: unknown): unknown {
  const b = asObject(rawBody);
  const wallet = b['stellar_wallet_public_key'];
  return {
    name: b['name'],
    legalName: b['legal_name'],
    document: { type: b['document_type'], number: b['document_number'] },
    adminEmail: b['admin_email'],
    defaultAsset: { code: b['default_asset_code'], issuer: b['default_asset_issuer'] ?? null },
    wallet:
      wallet === undefined || wallet === null
        ? undefined
        : { publicKey: wallet, network: b['stellar_network'] ?? 'TESTNET' },
  };
}

/** Map a snake_case wallet body to `AssignTenantWalletInputSchema` (StellarAccount). */
export function toAssignWalletInput(rawBody: unknown): unknown {
  const b = asObject(rawBody);
  return {
    publicKey: b['stellar_wallet_public_key'],
    network: b['stellar_network'] ?? 'TESTNET',
  };
}

export function tenantResponse(view: TenantView): Body {
  return {
    id: view.id,
    slug: view.slug,
    name: view.name,
    legal_name: view.legalName,
    document_type: view.document.type,
    document_number: view.document.number,
    admin_email: view.adminEmail,
    status: view.status,
    stellar_wallet_public_key: view.wallet?.publicKey ?? null,
    stellar_network: view.wallet?.network ?? null,
    default_asset_code: view.defaultAsset.code,
    default_asset_issuer: view.defaultAsset.issuer,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
  };
}

export function walletResponse(view: TenantWalletView): Body {
  return { stellar_wallet_public_key: view.publicKey, stellar_network: view.network };
}

// ---------------------------------------------------------------------------
// Payment orders
// ---------------------------------------------------------------------------

/**
 * Map a snake_case create-order body to `CreatePaymentOrderInputSchema`. The original body is
 * spread through so any (illegal) wallet field survives into the use case, which rejects it
 * (RN-02) — the mapping only adds camelCase aliases the schema understands.
 */
export function toCreateOrderInput(rawBody: unknown): unknown {
  const b = asObject(rawBody);
  const pick = (snake: string, camel: string): unknown => b[camel] ?? b[snake];
  return {
    ...b,
    tenantId: pick('tenant_id', 'tenantId'),
    slug: b['slug'],
    tenantDocument: pick('tenant_document', 'tenantDocument'),
    amount: b['amount'],
    assetCode: pick('asset_code', 'assetCode'),
    assetIssuer: pick('asset_issuer', 'assetIssuer'),
    dueDate: pick('due_date', 'dueDate'),
    externalId: pick('external_id', 'externalId'),
    callbackUrl: pick('callback_url', 'callbackUrl'),
    source: b['source'],
    description: b['description'],
    metadata: b['metadata'],
  };
}

export function orderResponse(view: PaymentOrderView): Body {
  return {
    id: view.id,
    tenant_id: view.tenantId,
    external_id: view.externalId,
    amount: view.amount,
    asset_code: view.assetCode,
    asset_issuer: view.assetIssuer,
    receiver_wallet_public_key: view.receiverWalletPublicKey,
    canonical_payload_hash: view.canonicalPayloadHash,
    status: view.status,
    source: view.source,
    due_date: view.dueDate,
    description: view.description,
    public_payment_slug: view.publicPaymentSlug,
    public_payment_url: view.publicPaymentUrl,
    soroban_contract_id: view.sorobanContractId,
    blockchain_transaction_hash: view.blockchainTransactionHash,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
    paid_at: view.paidAt ? view.paidAt.toISOString() : null,
  };
}

export function orderStatusResponse(view: PaymentOrderStatusView): Body {
  return {
    id: view.id,
    status: view.status,
    soroban_contract_id: view.sorobanContractId,
    blockchain_transaction_hash: view.blockchainTransactionHash,
    paid_at: view.paidAt ? view.paidAt.toISOString() : null,
    explorer_url: view.explorerUrl,
  };
}

export function eventResponse(view: PaymentOrderEventView): Body {
  return {
    event_type: view.eventType,
    payload: view.payload,
    created_at: view.createdAt.toISOString(),
  };
}

export function publicOrderResponse(view: PublicPaymentOrderView): Body {
  return {
    status: view.status,
    network: view.network,
    receiver: {
      name: view.receiver.name,
      document: view.receiver.document,
      wallet_public_key: view.receiver.walletPublicKey,
    },
    amount: view.amount,
    asset_code: view.assetCode,
    asset_issuer: view.assetIssuer,
    due_date: view.dueDate,
    order_id: view.orderId,
    canonical_payload_hash: view.canonicalPayloadHash,
    soroban_contract_id: view.sorobanContractId,
    explorer_url: view.explorerUrl,
  };
}

// ---------------------------------------------------------------------------
// Auth & pagination
// ---------------------------------------------------------------------------

export function loginResponse(result: LoginResult): Body {
  return {
    access_token: result.accessToken,
    token_type: result.tokenType,
    expires_in: result.expiresIn,
    admin: result.admin,
  };
}

/** Wrap a page of mapped items in the standard `{ items, total }` envelope. */
export function paginated<T>(page: { items: T[]; total: number }, map: (item: T) => Body): Body {
  return { items: page.items.map(map), total: page.total };
}
