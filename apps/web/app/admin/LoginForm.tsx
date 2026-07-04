'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { getConfig } from '@/src/config';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import { connectWallet, WalletError } from '@/src/stellar/freighter';
import { truncateMiddle } from '@/src/lib/format';
import { TestnetBanner } from '@/src/components/TestnetBanner';

type Mode = 'login' | 'register';
/** After registering, the admin is asked to connect a wallet before entering the panel. */
type Step = 'credentials' | 'connect-wallet';

/** Minimum password length — must match the API's `RegisterRequest` policy (spec 10 §5). */
const PASSWORD_MIN_LENGTH = 8;

export function LoginForm({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
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
        setError(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
        return;
      }
      if (password !== confirmPassword) {
        setError('As senhas não coincidem.');
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
      const fallback = isRegister ? 'Falha ao registrar.' : 'Falha ao autenticar.';
      setError(err instanceof ApiError ? messageForError(err, fallback) : fallback);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'connect-wallet' && pendingToken) {
    return <ConnectWalletStep token={pendingToken} onDone={() => onAuthenticated(pendingToken)} />;
  }

  return (
    <main className="container container-narrow">
      <TestnetBanner />
      <div className="card">
        <h1>{isRegister ? 'Criar conta' : 'Entrar'}</h1>
        <p className="muted">
          {isRegister
            ? 'Crie um acesso ao painel administrativo.'
            : 'Acesso ao painel administrativo.'}
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
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
              <label htmlFor="confirm-password">Confirmar senha</label>
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
            {isRegister ? 'Criar conta' : 'Entrar'}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          {isRegister ? (
            <>
              Já tem uma conta?{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                Entrar
              </button>
            </>
          ) : (
            <>
              Não tem uma conta?{' '}
              <button type="button" className="link-btn" onClick={() => switchMode('register')}>
                Criar conta
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

/**
 * Post-registration step: prompt the new admin to connect their Freighter wallet (Testnet) so
 * its public key is saved to their tenant. Non-custodial — only the public key is read, never a
 * secret. The admin may skip and configure a wallet later from the Tenants panel.
 */
function ConnectWalletStep({ token, onDone }: { token: string; onDone: () => void }) {
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
        setError(err.message || 'Falha ao salvar a carteira.');
      } else {
        setError('Não foi possível conectar a carteira. Verifique a extensão Freighter.');
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="container container-narrow">
      <TestnetBanner />
      <div className="card">
        <h1>Conecte sua carteira</h1>
        <p className="muted">
          Conta criada! Conecte sua carteira Stellar (Testnet) para definir a carteira de
          recebimento do seu tenant. Nunca pedimos sua chave secreta — apenas a chave pública.
        </p>
        {savedAddress ? (
          <div className="alert alert-success">
            Carteira <span className="mono">{truncateMiddle(savedAddress, 8, 8)}</span> salva.
          </div>
        ) : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        <button
          className="btn btn-primary btn-block"
          onClick={() => void connect()}
          disabled={connecting}
        >
          {connecting ? <span className="spinner" /> : null}
          Conectar carteira
        </button>
        <p className="muted" style={{ marginBottom: 0, textAlign: 'center' }}>
          <button type="button" className="link-btn" onClick={onDone} disabled={connecting}>
            Pular por enquanto
          </button>
        </p>
      </div>
    </main>
  );
}

/** Map known API error codes to friendly Portuguese copy; otherwise show the API message. */
function messageForError(err: ApiError, fallback: string): string {
  switch (err.code) {
    case 'EMAIL_ALREADY_REGISTERED':
      return 'Este e-mail já está cadastrado.';
    case 'PASSWORD_TOO_SHORT':
      return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    case 'INVALID_EMAIL':
      return 'Informe um e-mail válido.';
    default:
      return err.message || fallback;
  }
}
