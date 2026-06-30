'use client';

import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '@/src/config';
import { PayOrderApi } from '@/src/lib/api';
import { clearToken, loadToken, saveToken } from '@/src/auth/session';
import { LoginForm } from './LoginForm';
import { TenantsPanel } from './TenantsPanel';
import { OrdersPanel } from './OrdersPanel';

type Tab = 'tenants' | 'orders';

export function AdminDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('tenants');

  useEffect(() => {
    setToken(loadToken());
    setReady(true);
  }, []);

  const api = useMemo(() => new PayOrderApi(getConfig().apiBaseUrl, token), [token]);

  if (!ready) return null;

  if (!token) {
    return (
      <LoginForm
        onAuthenticated={(t) => {
          saveToken(t);
          setToken(t);
        }}
      />
    );
  }

  function logout() {
    clearToken();
    setToken(null);
  }

  return (
    <main className="container">
      <div className="toolbar">
        <div>
          <h1>Painel administrativo</h1>
          <span className="muted">PayOrder W3 Guardian · Testnet</span>
        </div>
        <button className="btn" onClick={logout}>
          Sair
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === 'tenants' ? 'active' : ''}`}
          onClick={() => setTab('tenants')}
        >
          Tenants
        </button>
        <button
          className={`tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => setTab('orders')}
        >
          Cobranças
        </button>
      </div>

      {tab === 'tenants' ? <TenantsPanel api={api} /> : <OrdersPanel api={api} />}
    </main>
  );
}
