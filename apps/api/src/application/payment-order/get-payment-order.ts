import type { OrderStatus } from '../../domain/payment-order/index.js';
import { ORDER_STATUSES } from '../../domain/payment-order/index.js';
import type { Page, PaymentOrderRepository } from '../ports/index.js';
import { notFound, unprocessable } from '../shared/errors.js';
import {
  explorerUrlFor,
  toEventView,
  toPaymentOrderView,
  type PaymentOrderEventView,
  type PaymentOrderStatusView,
  type PaymentOrderView,
} from './views.js';

/** Load one order by id (`ORDER_NOT_FOUND` when absent). */
export class GetPaymentOrder {
  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly publicWebUrl: string,
  ) {}

  async execute(id: string): Promise<PaymentOrderView> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { id });
    }
    return toPaymentOrderView(order, this.publicWebUrl);
  }
}

export interface ListPaymentOrdersQuery {
  tenantId?: string;
  status?: string;
  externalId?: string;
  limit?: number;
  offset?: number;
}

/** List orders with filters (spec 08 §3 — status/tenant/external_id) and pagination. */
export class ListPaymentOrders {
  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly publicWebUrl: string,
  ) {}

  async execute(query: ListPaymentOrdersQuery = {}): Promise<Page<PaymentOrderView>> {
    const page = await this.orders.list({
      tenantId: query.tenantId,
      status: parseStatus(query.status),
      externalId: query.externalId,
      limit: query.limit,
      offset: query.offset,
    });
    return {
      items: page.items.map((order) => toPaymentOrderView(order, this.publicWebUrl)),
      total: page.total,
    };
  }
}

/** On-chain / off-chain status snapshot (spec 08 §3 — GET .../status). */
export class GetPaymentOrderStatus {
  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly explorerBaseUrl: string,
  ) {}

  async execute(id: string): Promise<PaymentOrderStatusView> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { id });
    }
    return {
      id: order.id,
      status: order.status,
      sorobanContractId: order.sorobanContractId,
      blockchainTransactionHash: order.blockchainTxHash,
      paidAt: order.paidAt,
      explorerUrl: explorerUrlFor(this.explorerBaseUrl, order.sorobanContractId),
    };
  }
}

/** Ordered event trail for an order (spec 08 §3 — GET .../events). */
export class GetPaymentOrderEvents {
  constructor(private readonly orders: PaymentOrderRepository) {}

  async execute(id: string): Promise<PaymentOrderEventView[]> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', 'Payment order not found', { id });
    }
    const events = await this.orders.listEvents(id);
    return events.map(toEventView);
  }
}

function parseStatus(value: string | undefined): OrderStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(value)) {
    throw unprocessable('INVALID_STATUS_FILTER', 'Unknown order status', { status: value });
  }
  return value as OrderStatus;
}
