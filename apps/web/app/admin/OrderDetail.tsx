'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { PaymentOrder, PaymentOrderEvent } from '@/src/lib/types';
import { formatAssetAmount, formatDate, formatDateTime } from '@/src/lib/format';
import { StatusBadge } from '@/src/components/StatusBadge';
import { DetailRow } from '@/src/components/DetailRow';
import { useI18n } from '@/src/i18n/LanguageProvider';

export function OrderDetail({
  api,
  order,
  onClose,
  onChanged,
}: {
  api: PayOrderApi;
  order: PaymentOrder;
  onClose: () => void;
  onChanged: (order: PaymentOrder) => void;
}) {
  const { t } = useI18n();
  const [events, setEvents] = useState<PaymentOrderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.getOrderEvents(order.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('orderDetail.errorLoadEvents'));
    } finally {
      setLoading(false);
    }
  }, [api, order.id, t]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const updated = await api.cancelOrder(order.id);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('orderDetail.errorCancel'));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>{t('orderDetail.title')}</h2>
        <button className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>

      <DetailRow label={t('orderDetail.id')}>
        <span className="mono">{order.id}</span>
      </DetailRow>
      <DetailRow label={t('orderDetail.status')}>
        <StatusBadge status={order.status} />
      </DetailRow>
      <DetailRow label={t('orderDetail.amount')}>
        {formatAssetAmount(order.amount, order.asset_code)}
      </DetailRow>
      <DetailRow label={t('orderDetail.destWallet')}>
        <span className="mono">{order.receiver_wallet_public_key}</span>
      </DetailRow>
      <DetailRow label={t('orderDetail.payloadHash')}>
        <span className="mono">{order.canonical_payload_hash}</span>
      </DetailRow>
      <DetailRow label={t('orderDetail.dueDate')}>{formatDate(order.due_date)}</DetailRow>
      <DetailRow label={t('orderDetail.publicLink')}>
        <a href={order.public_payment_url} target="_blank" rel="noreferrer">
          {order.public_payment_slug}
        </a>
      </DetailRow>
      {order.blockchain_transaction_hash ? (
        <DetailRow label={t('orderDetail.onChainTx')}>
          <span className="mono">{order.blockchain_transaction_hash}</span>
        </DetailRow>
      ) : null}

      {order.status === 'ACTIVE' ? (
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={cancel} disabled={cancelling}>
            {cancelling ? <span className="spinner" /> : null}
            {t('orderDetail.cancelOrder')}
          </button>
        </div>
      ) : null}

      <h2 style={{ marginTop: 24 }}>{t('orderDetail.events')}</h2>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="muted">{t('orderDetail.loadingEvents')}</p> : null}
      {!loading && events.length === 0 ? (
        <p className="muted">{t('orderDetail.noEvents')}</p>
      ) : null}
      {events.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t('orderDetail.colEvent')}</th>
              <th>{t('orderDetail.colDate')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.event_type}</td>
                <td className="muted">{formatDateTime(event.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
