/**
 * Origin of a payment order (spec 03 §2.2, 08 §3.1). The flow is identical across origins;
 * the source is recorded for auditing/analytics only. Values are normalized to lowercase
 * (`manual` is the DB default, spec 09 §2).
 */
export const ORDER_SOURCES = ['manual', 'api', 'erp'] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

export const DEFAULT_ORDER_SOURCE: OrderSource = 'manual';

export function isOrderSource(value: unknown): value is OrderSource {
  return typeof value === 'string' && (ORDER_SOURCES as readonly string[]).includes(value);
}

/**
 * Normalize a free-form source (e.g. `"ERP"`, `"API"`) to a known lowercase source,
 * falling back to `manual` for unknown/empty values.
 */
export function normalizeOrderSource(value: string | null | undefined): OrderSource {
  if (value == null) {
    return DEFAULT_ORDER_SOURCE;
  }
  const lower = value.trim().toLowerCase();
  return isOrderSource(lower) ? lower : DEFAULT_ORDER_SOURCE;
}
