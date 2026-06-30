/**
 * PaymentOrder lifecycle (spec 03 §3). `CREATED` is a transient off-chain state while the
 * order awaits on-chain registration; `ACTIVE` is the only payable state. The four terminal
 * states have no outgoing transitions.
 */
export const ORDER_STATUSES = [
  'CREATED',
  'ACTIVE',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed transitions. `CREATED → FAILED` covers an irreversible failure of the on-chain
 * registration job, before the order ever reaches `ACTIVE` (spec 03 §3 / RN list).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CREATED: ['ACTIVE', 'FAILED'],
  ACTIVE: ['PAID', 'EXPIRED', 'CANCELLED', 'FAILED'],
  PAID: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}
