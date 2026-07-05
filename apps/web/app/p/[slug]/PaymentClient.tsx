'use client';

import { useEffect, useState } from 'react';
import { getConfig } from '@/src/config';
import { PayOrderApi } from '@/src/lib/api';
import type { PublicPaymentOrder } from '@/src/lib/types';
import { formatAssetAmount, formatDate } from '@/src/lib/format';
import { StatusBadge } from '@/src/components/StatusBadge';
import { DetailRow } from '@/src/components/DetailRow';
import { TestnetBanner } from '@/src/components/TestnetBanner';
import { LanguageSwitch } from '@/src/components/LanguageSwitch';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { connectWallet, WalletError } from '@/src/stellar/freighter';
import { payOrder } from '@/src/stellar/pay-flow';
import { deriveOrderRefHex } from '@/src/stellar/scval';
import { contractExplorerUrl, txExplorerUrl } from '@/src/stellar/network';

interface Props {
  slug: string;
  initialOrder: PublicPaymentOrder | null;
  initialError: string | null;
}

export function PaymentClient({ slug, initialOrder, initialError }: Props) {
  const { t } = useI18n();
  const config = getConfig();
  const [order, setOrder] = useState<PublicPaymentOrder | null>(initialOrder);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  // Auto-load when the server-rendered order is missing (e.g. the API was unreachable during
  // SSR): we retry from the browser on mount instead of forcing the user to click "Atualizar".
  const [loading, setLoading] = useState(!initialOrder);
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function errorMessage(err: unknown): string {
    if (err instanceof WalletError) return err.message;
    if (err instanceof Error) return err.message;
    return t('common.unexpectedError');
  }

  async function refresh() {
    setLoading(true);
    setLoadError(null);
    try {
      const fresh = await new PayOrderApi(config.apiBaseUrl).getPublicOrder(slug);
      setOrder(fresh);
      return fresh;
    } catch {
      setLoadError(t('payment.errorLoad'));
      return null;
    } finally {
      setLoading(false);
    }
  }

  // The on-chain payment is confirmed by Freighter/Soroban RPC immediately, but the backend
  // only learns about it from a periodic reconciliation sweep (~30s). Poll the public status
  // endpoint until it reflects PAID so the page updates itself instead of requiring a manual
  // browser refresh.
  async function pollUntilPaid() {
    setConfirming(true);
    const deadline = Date.now() + 90_000;
    try {
      while (Date.now() < deadline) {
        const fresh = await refresh();
        if (fresh?.status === 'PAID') return;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    } finally {
      setConfirming(false);
    }
  }

  // Run once on mount: if SSR could not provide the order, retry the load from the browser.
  useEffect(() => {
    if (!initialOrder) {
      void refresh();
    }
  }, []);

  async function onConnect() {
    setConnecting(true);
    setPayError(null);
    try {
      const connected = await connectWallet();
      setWallet(connected.address);
    } catch (err) {
      setPayError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  }

  async function onPay() {
    if (!order || !order.soroban_contract_id || !wallet) return;
    setPaying(true);
    setPayError(null);
    try {
      const orderRefHex = await deriveOrderRefHex(order.order_id);
      const result = await payOrder({
        rpcUrl: config.sorobanRpcUrl,
        contractId: order.soroban_contract_id,
        payer: wallet,
        orderRefHex,
        amount: order.amount,
        asset: { code: order.asset_code, issuer: order.asset_issuer },
      });
      setTxHash(result.txHash);
      await pollUntilPaid();
    } catch (err) {
      setPayError(errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  if (!order) {
    return (
      <main className="container container-narrow">
        <div className="toolbar">
          <div />
          <LanguageSwitch />
        </div>
        <TestnetBanner />
        <div className="card">
          <h1>{t('payment.title')}</h1>
          {loading ? (
            <p className="muted">
              <span className="spinner" /> {t('payment.loading')}
            </p>
          ) : (
            <>
              <div className="alert alert-error">{loadError ?? t('payment.notFound')}</div>
              <button className="btn" onClick={refresh} disabled={loading}>
                {t('common.updating')}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  const isPaid = order.status === 'PAID';
  const isActive = order.status === 'ACTIVE';
  const awaitingRegistration = order.status === 'CREATED' || order.soroban_contract_id === null;
  const isTerminal =
    order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'FAILED';

  return (
    <main className="container container-narrow">
      <div className="toolbar">
        <div />
        <LanguageSwitch />
      </div>
      <TestnetBanner />

      <div className="card">
        <div className="toolbar">
          <h1>{t('payment.payTitle')}</h1>
          <StatusBadge status={order.status} />
        </div>

        <p className="muted">{t('payment.payingFor')}</p>
        <h2 style={{ marginTop: 0 }}>{order.receiver.name}</h2>

        <div className="amount">{formatAssetAmount(order.amount, order.asset_code)}</div>

        <div style={{ marginTop: 20 }}>
          <DetailRow label={t('payment.destWallet')}>
            <span className="mono">{order.receiver.wallet_public_key}</span>
          </DetailRow>
          {order.receiver.document ? (
            <DetailRow label={t('payment.document')}>{order.receiver.document}</DetailRow>
          ) : null}
          <DetailRow label={t('payment.network')}>{order.network}</DetailRow>
          <DetailRow label={t('payment.dueDate')}>{formatDate(order.due_date)}</DetailRow>
          <DetailRow label={t('payment.payloadHash')}>
            <span className="mono">{order.canonical_payload_hash}</span>
          </DetailRow>
          {order.soroban_contract_id ? (
            <DetailRow label={t('payment.contract')}>
              <a
                href={contractExplorerUrl(config.explorerBaseUrl, order.soroban_contract_id)}
                target="_blank"
                rel="noreferrer"
              >
                {t('payment.viewExplorer')}
              </a>
            </DetailRow>
          ) : null}
        </div>
      </div>

      <div className="card">
        {isPaid ? (
          <div>
            <div className="alert alert-success">{t('payment.confirmed')}</div>
            {txHash ? (
              <a
                href={txExplorerUrl(config.explorerBaseUrl, txHash)}
                target="_blank"
                rel="noreferrer"
              >
                {t('payment.viewTxExplorer')}
              </a>
            ) : null}
          </div>
        ) : null}

        {awaitingRegistration && !isPaid ? (
          <div>
            <p className="muted">{t('payment.awaitingRegistration')}</p>
            <button className="btn" onClick={refresh}>
              {t('payment.updateStatus')}
            </button>
          </div>
        ) : null}

        {isTerminal ? <p className="muted">{t('payment.terminal')}</p> : null}

        {isActive && !isPaid && confirming ? (
          <div className="stack">
            <p className="muted">
              <span className="spinner" /> {t('payment.confirming')}
            </p>
          </div>
        ) : null}

        {isActive && !isPaid && !confirming ? (
          <div className="stack">
            {!wallet ? (
              <button
                className="btn btn-primary btn-block"
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? <span className="spinner" /> : null}
                {t('payment.connectWallet')}
              </button>
            ) : (
              <>
                <DetailRow label={t('payment.payingWith')}>
                  <span className="mono">{wallet}</span>
                </DetailRow>
                <button className="btn btn-primary btn-block" onClick={onPay} disabled={paying}>
                  {paying ? <span className="spinner" /> : null}
                  {t('payment.pay', { amount: formatAssetAmount(order.amount, order.asset_code) })}
                </button>
              </>
            )}
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              {t('payment.nonCustodialNote')}
            </p>
          </div>
        ) : null}

        {payError ? <div className="alert alert-error">{payError}</div> : null}
        {loadError ? <div className="alert alert-error">{loadError}</div> : null}
      </div>
    </main>
  );
}
