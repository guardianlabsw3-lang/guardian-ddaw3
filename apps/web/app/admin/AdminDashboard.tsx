'use client';

import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '@/src/config';
import { PayOrderApi } from '@/src/lib/api';
import { clearToken, loadToken, saveToken } from '@/src/auth/session';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { LanguageSwitch } from '@/src/components/LanguageSwitch';
import { BrandMark } from '@/src/components/BrandLogo';
import { LoginForm } from './LoginForm';
import { TenantsPanel } from './TenantsPanel';
import { OrdersPanel } from './OrdersPanel';

type Tab = 'tenants' | 'orders';

export function AdminDashboard() {
  const { t } = useI18n();
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
        onAuthenticated={(newToken) => {
          saveToken(newToken);
          setToken(newToken);
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
        <div className="page-brand">
          <BrandMark size={44} className="brand-mark" />
          <div>
            <h1>{t('admin.title')}</h1>
            <span className="muted">{t('admin.subtitle')}</span>
          </div>
        </div>
        <div className="inline">
          <LanguageSwitch />
          <button className="btn" onClick={logout}>
            {t('admin.logout')}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === 'tenants' ? 'active' : ''}`}
          onClick={() => setTab('tenants')}
        >
          {t('admin.tabTenants')}
        </button>
        <button
          className={`tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => setTab('orders')}
        >
          {t('admin.tabOrders')}
        </button>
      </div>

      {tab === 'tenants' ? <TenantsPanel api={api} /> : <OrdersPanel api={api} />}
    </main>
  );
}
