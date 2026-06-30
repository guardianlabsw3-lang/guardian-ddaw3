import type { OrderStatus } from '../lib/types';
import { statusLabel, statusTone } from '../lib/format';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${statusTone(status)}`}>{statusLabel(status)}</span>;
}
