'use client';

import { useState } from 'react';
import { getConfig } from '@/src/config';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import { connectWallet, WalletError } from '@/src/stellar/freighter';
import { truncateMiddle } from '@/src/lib/format';
import { useI18n } from '@/src/i18n/LanguageProvider';

/**
 * Mandatory wallet-connect gate (feature "onboarding-wallet-required"). Shown right after
 * registration and, for a returning session, whenever the authenticated admin's tenant has no
 * wallet yet. There is deliberately no skip: the API rejects every other admin route with
 * `403 WALLET_REQUIRED` until this succeeds, so an escape hatch here would only trade an
 * honest gate for a confusing error later.
 */
export function ConnectWalletStep({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n();
  const [connecting, setConnecting] = useState(false);
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { address } = await connectWallet();
      const api = new PayOrderApi(getConfig().apiBaseUrl, token);
      await api.onboardWallet(address);
      setSavedAddress(address);
      onDone();
    } catch (err) {
      if (err instanceof WalletError) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message || t('login.walletErrorSave'));
      } else {
        setError(t('login.walletErrorConnect'));
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="login-panel">
      <h1>{t('login.walletTitle')}</h1>
      <p className="muted">{t('login.walletSubtitle')}</p>
      {savedAddress ? (
        <div className="alert alert-success">
          {t('login.walletSaved', { address: truncateMiddle(savedAddress, 8, 8) })}
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      <button
        className="btn btn-primary btn-block"
        onClick={() => void connect()}
        disabled={connecting}
      >
        {connecting ? <span className="spinner" /> : null}
        {t('login.walletConnect')}
      </button>
    </div>
  );
}
