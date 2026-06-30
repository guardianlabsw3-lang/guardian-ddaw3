import type { PaymentOrder } from '../../domain/payment-order/index.js';
import type { PaymentOrderEventRecord } from '../ports/index.js';

/** Read model for a payment order returned by use cases (spec 08 §3.1 response shape). */
export interface PaymentOrderView {
  id: string;
  tenantId: string;
  externalId: string | null;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  receiverWalletPublicKey: string;
  canonicalPayloadHash: string;
  status: string;
  source: string;
  dueDate: string | null;
  description: string | null;
  publicPaymentSlug: string;
  publicPaymentUrl: string;
  sorobanContractId: string | null;
  blockchainTransactionHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

export function publicPaymentUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/p/${slug}`;
}

/** Stellar.expert contract explorer URL (spec 08 §3.2); null until registered on-chain. */
export function explorerUrlFor(baseUrl: string, contractId: string | null): string | null {
  if (!contractId) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}/contract/${contractId}`;
}

/** Status snapshot returned by `GET /api/payment-orders/{id}/status`. */
export interface PaymentOrderStatusView {
  id: string;
  status: string;
  sorobanContractId: string | null;
  blockchainTransactionHash: string | null;
  paidAt: Date | null;
  explorerUrl: string | null;
}

export function toPaymentOrderView(order: PaymentOrder, publicBaseUrl: string): PaymentOrderView {
  return {
    id: order.id,
    tenantId: order.tenantId,
    externalId: order.externalId,
    amount: order.amount,
    assetCode: order.asset.code,
    assetIssuer: order.asset.issuer,
    receiverWalletPublicKey: order.receiverWallet,
    canonicalPayloadHash: order.canonicalPayloadHash,
    status: order.status,
    source: order.source,
    dueDate: order.dueDate,
    description: order.description,
    publicPaymentSlug: order.publicSlug,
    publicPaymentUrl: publicPaymentUrl(publicBaseUrl, order.publicSlug),
    sorobanContractId: order.sorobanContractId,
    blockchainTransactionHash: order.blockchainTxHash,
    metadata: order.metadata,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
  };
}

export interface PaymentOrderEventView {
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export function toEventView(record: PaymentOrderEventRecord): PaymentOrderEventView {
  return { eventType: record.eventType, payload: record.payload, createdAt: record.createdAt };
}
