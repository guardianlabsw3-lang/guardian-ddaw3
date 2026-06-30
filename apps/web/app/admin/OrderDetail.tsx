'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { PaymentOrder, PaymentOrderEvent } from '@/src/lib/types';
import { formatAssetAmount, formatDate, formatDateTime } from '@/src/lib/format';
import { StatusBadge } from '@/src/components/StatusBadge';
import { DetailRow } from '@/src/components/DetailRow';

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
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar eventos.');
    } finally {
      setLoading(false);
    }
  }, [api, order.id]);

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
      setError(err instanceof ApiError ? err.message : 'Falha ao cancelar.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Detalhes da cobrança</h2>
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>

      <DetailRow label="ID">
        <span className="mono">{order.id}</span>
      </DetailRow>
      <DetailRow label="Status">
        <StatusBadge status={order.status} />
      </DetailRow>
      <DetailRow label="Valor">{formatAssetAmount(order.amount, order.asset_code)}</DetailRow>
      <DetailRow label="Carteira destino">
        <span className="mono">{order.receiver_wallet_public_key}</span>
      </DetailRow>
      <DetailRow label="Hash do payload">
        <span className="mono">{order.canonical_payload_hash}</span>
      </DetailRow>
      <DetailRow label="Vencimento">{formatDate(order.due_date)}</DetailRow>
      <DetailRow label="Link público">
        <a href={order.public_payment_url} target="_blank" rel="noreferrer">
          {order.public_payment_slug}
        </a>
      </DetailRow>
      {order.blockchain_transaction_hash ? (
        <DetailRow label="Tx on-chain">
          <span className="mono">{order.blockchain_transaction_hash}</span>
        </DetailRow>
      ) : null}

      {order.status === 'ACTIVE' ? (
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={cancel} disabled={cancelling}>
            {cancelling ? <span className="spinner" /> : null}
            Cancelar cobrança
          </button>
        </div>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Eventos</h2>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="muted">Carregando eventos…</p> : null}
      {!loading && events.length === 0 ? <p className="muted">Sem eventos.</p> : null}
      {events.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Data</th>
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
