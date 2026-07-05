'use client';

import type { OrderStatus } from '../lib/types';
import { statusTone } from '../lib/format';
import { useI18n } from '@/src/i18n/LanguageProvider';

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${statusTone(status)}`}>{t(`status.${status}`)}</span>;
}
