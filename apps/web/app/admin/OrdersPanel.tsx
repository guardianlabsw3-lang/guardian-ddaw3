'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { PaymentOrder } from '@/src/lib/types';
import { formatAssetAmount, formatDateTime, truncateMiddle } from '@/src/lib/format';
import { StatusBadge } from '@/src/components/StatusBadge';
import { CreateOrderForm } from './CreateOrderForm';
import { OrderDetail } from './OrderDetail';

export function OrdersPanel({ api }: { api: PayOrderApi }) {
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PaymentOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await api.listOrders());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar cobranças.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function upsert(order: PaymentOrder) {
    setOrders((current) => {
      const exists = current.some((o) => o.id === order.id);
      return exists ? current.map((o) => (o.id === order.id ? order : o)) : [order, ...current];
    });
  }

  if (selected) {
    return (
      <OrderDetail
        api={api}
        order={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => {
          upsert(updated);
          setSelected(updated);
        }}
      />
    );
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Cobranças</h2>
        <div className="inline">
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Atualizar
          </button>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Fechar' : 'Nova cobrança'}
          </button>
        </div>
      </div>

      {creating ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Nova cobrança manual</h2>
          <CreateOrderForm
            api={api}
            onCreated={(order) => {
              upsert(order);
              setCreating(false);
            }}
          />
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="muted">Carregando…</p> : null}
      {!loading && orders.length === 0 ? <p className="muted">Nenhuma cobrança.</p> : null}

      {orders.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Cobrança</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Criada</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <span className="mono">
                    {order.external_id ?? truncateMiddle(order.id, 8, 6)}
                  </span>
                </td>
                <td>{formatAssetAmount(order.amount, order.asset_code)}</td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                <td className="muted">{formatDateTime(order.created_at)}</td>
                <td>
                  <button className="link-btn" onClick={() => setSelected(order)}>
                    detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
