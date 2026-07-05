'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { getConfig } from '@/src/config';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import { connectWallet, WalletError } from '@/src/stellar/freighter';
import { truncateMiddle } from '@/src/lib/format';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { LanguageSwitch } from '@/src/components/LanguageSwitch';

type Mode = 'login' | 'register';
/** After registering, the admin is asked to connect a wallet before entering the panel. */
type Step = 'credentials' | 'connect-wallet';

/** Minimum password length — must match the API's `RegisterRequest` policy (spec 10 §5). */
const PASSWORD_MIN_LENGTH = 8;

function BrandAside() {
  const { t } = useI18n();
  return (
    <aside className="login-aside">
      <div className="login-brand">
        <span className="login-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path
              d="M12 2.5l7 2.6v5.2c0 4.8-3 8.9-7 10.2-4-1.3-7-5.4-7-10.2V5.1l7-2.6z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <rect
              x="9.4"
              y="11.2"
              width="5.2"
              height="4.2"
              rx="0.8"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M10.3 11.2v-1.4a1.7 1.7 0 0 1 3.4 0v1.4"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </span>
        <div className="login-brand-name">{t('login.brand')}</div>
      </div>

      <div className="login-hero">
        <h1>{t('login.heroTitle')}</h1>
        <p>{t('login.heroSubtitle')}</p>
      </div>

      <div className="login-badges">
        <span className="login-badge">Ed25519</span>
        <span className="login-badge">SHA-256</span>
        <span className="login-badge">Stellar Soroban</span>
      </div>
    </aside>
  );
}

export function LoginForm({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>('credentials');
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isRegister = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isRegister) {
      if (password.length < PASSWORD_MIN_LENGTH) {
        setError(t('login.errorPasswordLength', { min: PASSWORD_MIN_LENGTH }));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('login.errorPasswordMismatch'));
        return;
      }
    }

    setLoading(true);
    try {
      const api = new PayOrderApi(getConfig().apiBaseUrl);
      if (isRegister) {
        // New account: hold the token and prompt for a wallet before entering the panel.
        const { token } = await api.register(email, password);
        setPendingToken(token);
        setStep('connect-wallet');
      } else {
        const { token } = await api.login(email, password);
        onAuthenticated(token);
      }
    } catch (err) {
      const fallback = isRegister
        ? t('login.errorRegisterFallback')
        : t('login.errorLoginFallback');
      setError(err instanceof ApiError ? messageForError(err, fallback, t) : fallback);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'connect-wallet' && pendingToken) {
    return (
      <div className="login-screen">
        <BrandAside />
        <div className="login-panel-wrap">
          <div className="login-panel-topbar">
            <LanguageSwitch />
          </div>
          <ConnectWalletStep token={pendingToken} onDone={() => onAuthenticated(pendingToken)} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <BrandAside />
      <div className="login-panel-wrap">
        <div className="login-panel-topbar">
          <LanguageSwitch />
        </div>
        <div className="login-panel">
          <p className="login-eyebrow">{t('login.eyebrow')}</p>
          <h1>{isRegister ? t('login.titleRegister') : t('login.titleLogin')}</h1>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">{t('login.emailLabel')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                autoComplete="username"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t('login.passwordLabel')}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? PASSWORD_MIN_LENGTH : undefined}
                required
              />
            </div>
            {isRegister ? (
              <div className="field">
                <label htmlFor="confirm-password">{t('login.confirmPasswordLabel')}</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                />
              </div>
            ) : null}
            {error ? <div className="alert alert-error">{error}</div> : null}
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {isRegister ? t('login.submitRegister') : t('login.submitLogin')}
            </button>
          </form>
          <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
            {isRegister ? (
              <>
                {t('login.haveAccount')}{' '}
                <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                  {t('login.signIn')}
                </button>
              </>
            ) : (
              <>
                {t('login.noAccount')}{' '}
                <button type="button" className="link-btn" onClick={() => switchMode('register')}>
                  {t('login.createAccount')}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Post-registration step: prompt the new admin to connect their Freighter wallet (Testnet) so
 * its public key is saved to their tenant. Non-custodial — only the public key is read, never a
 * secret. The admin may skip and configure a wallet later from the Tenants panel.
 */
function ConnectWalletStep({ token, onDone }: { token: string; onDone: () => void }) {
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
      <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
        <button type="button" className="link-btn" onClick={onDone} disabled={connecting}>
          {t('login.walletSkip')}
        </button>
      </p>
    </div>
  );
}

/** Map known API error codes to friendly copy in the active language; otherwise show the API message. */
function messageForError(
  err: ApiError,
  fallback: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (err.code) {
    case 'EMAIL_ALREADY_REGISTERED':
      return t('login.errorEmailAlreadyRegistered');
    case 'PASSWORD_TOO_SHORT':
      return t('login.errorPasswordTooShort', { min: PASSWORD_MIN_LENGTH });
    case 'INVALID_EMAIL':
      return t('login.errorInvalidEmail');
    default:
      return err.message || fallback;
  }
}
