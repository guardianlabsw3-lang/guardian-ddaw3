'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { getConfig } from '@/src/config';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import { TestnetBanner } from '@/src/components/TestnetBanner';

type Mode = 'login' | 'register';

/** Minimum password length — must match the API's `RegisterRequest` policy (spec 10 §5). */
const PASSWORD_MIN_LENGTH = 8;

export function LoginForm({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
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
      const { token } = isRegister
        ? await api.register(email, password)
        : await api.login(email, password);
      onAuthenticated(token);
    } catch (err) {
      const fallback = isRegister ? 'Falha ao registrar.' : 'Falha ao autenticar.';
      setError(err instanceof ApiError ? messageForError(err, fallback) : fallback);
    } finally {
      setLoading(false);
    }
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
