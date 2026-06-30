import type { OrderStatus } from './types';

/**
 * Presentation helpers shared by the public page and admin panel. Pure and unit-tested
 * (no DOM), so formatting stays deterministic across server and client renders.
 */

/** Trim trailing zeros from a 7-scale Stellar amount for display ("150.0000000" → "150"). */
export function formatAmountForDisplay(amount: string): string {
  if (!amount.includes('.')) return amount;
  const trimmed = amount.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

/** "150" + "XLM" → "150 XLM". */
export function formatAssetAmount(amount: string, assetCode: string): string {
  return `${formatAmountForDisplay(amount)} ${assetCode}`;
}

/** Shorten a long hash/key for compact display: "GBPAY…ENANT". */
export function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** ISO date/datetime → "YYYY-MM-DD" for due dates (kept timezone-agnostic). */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

/** ISO datetime → readable UTC string; falls back to the raw value if unparseable. */
export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  CREATED: 'Aguardando registro',
  ACTIVE: 'Aguardando pagamento',
  PAID: 'Pago',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
};

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** A semantic tone for the status badge, mapped to CSS classes in the UI. */
export function statusTone(status: OrderStatus): 'pending' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'ACTIVE':
      return 'pending';
    case 'CREATED':
      return 'neutral';
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}
