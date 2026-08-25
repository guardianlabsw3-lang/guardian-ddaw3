'use client';

import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '@/src/config';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import { clearToken, loadToken, saveToken } from '@/src/auth/session';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { LanguageSwitch } from '@/src/components/LanguageSwitch';
import { BrandMark } from '@/src/components/BrandLogo';
import { LoginForm } from './LoginForm';
import { ConnectWalletStep } from './ConnectWalletStep';
import { TenantsPanel } from './TenantsPanel';
import { OrdersPanel } from './OrdersPanel';

type Tab = 'tenants' | 'orders';
/** Whether the session's account has cleared the mandatory wallet-connect gate. */
type WalletGate = 'checking' | 'required' | 'cleared';

export function AdminDashboard() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [walletGate, setWalletGate] = useState<WalletGate>('checking');
  const [tab, setTab] = useState<Tab>('tenants');

  useEffect(() => {
    setToken(loadToken());
    setReady(true);
  }, []);

  const api = useMemo(() => new PayOrderApi(getConfig().apiBaseUrl, token), [token]);

  // A returning session may belong to an account that never finished onboarding a wallet
  // (feature "onboarding-wallet-required") — check on every load and re-show the gate instead
  // of letting every other panel call fail with 403 WALLET_REQUIRED one at a time.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setWalletGate('checking');
    new PayOrderApi(getConfig().apiBaseUrl, token)
      .getOnboardingStatus()
      .then((status) => {
        if (!cancelled) setWalletGate(status.has_wallet ? 'cleared' : 'required');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          setToken(null);
        } else {
          // The API still enforces the real gate on every other route; fail open here so a
          // transient error never locks out an admin who already has a wallet.
          setWalletGate('cleared');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  if (walletGate !== 'cleared') {
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
        {walletGate === 'required' ? (
          <ConnectWalletStep token={token} onDone={() => setWalletGate('cleared')} />
        ) : null}
      </main>
    );
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
