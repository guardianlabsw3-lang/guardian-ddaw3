import type { PaymentOrderRepository, TenantRepository } from '../ports/index.js';
import { notFound } from '../shared/errors.js';
import { explorerUrlFor } from './views.js';

/**
 * Public payment view (spec 08 §3.2). Deliberately excludes sensitive data — admin email,
 * internal metadata, API keys (spec 08 §3.2 / spec 10 §7). The receiver document is masked
 * to a display form so the payer can recognise the merchant without exposing the raw number.
 */
export interface PublicPaymentOrderView {
  status: string;
  network: string;
  receiver: { name: string; document: string; walletPublicKey: string };
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  dueDate: string | null;
  orderId: string;
  canonicalPayloadHash: string;
  sorobanContractId: string | null;
  explorerUrl: string | null;
}

export interface GetPublicPaymentOrderDeps {
  orders: PaymentOrderRepository;
  tenants: TenantRepository;
  network: string;
  explorerBaseUrl: string;
}

/** Resolve the public payment page data for a `public_payment_slug`. */
export class GetPublicPaymentOrder {
  constructor(private readonly deps: GetPublicPaymentOrderDeps) {}

  async execute(slug: string): Promise<PublicPaymentOrderView> {
    const order = await this.deps.orders.findBySlug(slug);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { slug });
    }
    const tenant = await this.deps.tenants.findById(order.tenantId);
    if (!tenant) {
      // Referential integrity guarantees this never happens; fail closed if it does.
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { slug });
    }

    return {
      status: order.status,
      network: this.deps.network,
      receiver: {
        name: tenant.name,
        document: maskDocument(tenant.document.type, tenant.document.number),
        walletPublicKey: order.receiverWallet,
      },
      amount: order.amount,
      assetCode: order.asset.code,
      assetIssuer: order.asset.issuer,
      dueDate: order.dueDate,
      orderId: order.id,
      canonicalPayloadHash: order.canonicalPayloadHash,
      sorobanContractId: order.sorobanContractId,
      explorerUrl: explorerUrlFor(this.deps.explorerBaseUrl, order.sorobanContractId),
    };
  }
}

/**
 * Mask a document for public display: keep the format recognisable (CNPJ/CPF punctuation)
 * but obscure the middle digits so the full number is never published.
 */
export function maskDocument(type: string, number: string): string {
  const digits = number.replace(/\D/g, '');
  if (type === 'CNPJ' && digits.length === 14) {
    return `**.***.${digits.slice(8, 11)}/${digits.slice(11, 12)}***-**`;
  }
  if (type === 'CPF' && digits.length === 11) {
    return `***.${digits.slice(3, 6)}.***-**`;
  }
  if (digits.length <= 4) {
    return '****';
  }
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
