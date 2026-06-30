'use client';

import { useState } from 'react';
import { getConfig } from '@/src/config';
import { PayOrderApi } from '@/src/lib/api';
import type { PublicPaymentOrder } from '@/src/lib/types';
import { formatAssetAmount, formatDate } from '@/src/lib/format';
import { StatusBadge } from '@/src/components/StatusBadge';
import { DetailRow } from '@/src/components/DetailRow';
import { TestnetBanner } from '@/src/components/TestnetBanner';
import { connectWallet, WalletError } from '@/src/stellar/freighter';
import { payOrder } from '@/src/stellar/pay-flow';
import { deriveOrderRefHex } from '@/src/stellar/scval';
import { contractExplorerUrl, txExplorerUrl } from '@/src/stellar/network';

interface Props {
  slug: string;
  initialOrder: PublicPaymentOrder | null;
  initialError: string | null;
}

function errorMessage(err: unknown): string {
  if (err instanceof WalletError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

export function PaymentClient({ slug, initialOrder, initialError }: Props) {
  const config = getConfig();
  const [order, setOrder] = useState<PublicPaymentOrder | null>(initialOrder);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function refresh() {
    setLoadError(null);
    try {
      const fresh = await new PayOrderApi(config.apiBaseUrl).getPublicOrder(slug);
      setOrder(fresh);
    } catch {
      setLoadError('Não foi possível atualizar a cobrança.');
    }
  }

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
      await refresh();
    } catch (err) {
      setPayError(errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  if (!order) {
    return (
      <main className="container container-narrow">
        <TestnetBanner />
        <div className="card">
          <h1>Cobrança</h1>
          <div className="alert alert-error">{loadError ?? 'Cobrança não encontrada.'}</div>
          <button className="btn" onClick={refresh}>
            Atualizar
          </button>
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
      <TestnetBanner />

      <div className="card">
        <div className="toolbar">
          <h1>Pagar cobrança</h1>
          <StatusBadge status={order.status} />
        </div>

        <p className="muted">Pagamento para</p>
        <h2 style={{ marginTop: 0 }}>{order.receiver.name}</h2>

        <div className="amount">{formatAssetAmount(order.amount, order.asset_code)}</div>

        <div style={{ marginTop: 20 }}>
          <DetailRow label="Carteira destino">
            <span className="mono">{order.receiver.wallet_public_key}</span>
          </DetailRow>
          {order.receiver.document ? (
            <DetailRow label="Documento">{order.receiver.document}</DetailRow>
          ) : null}
          <DetailRow label="Rede">{order.network}</DetailRow>
          <DetailRow label="Vencimento">{formatDate(order.due_date)}</DetailRow>
          <DetailRow label="Hash do payload">
            <span className="mono">{order.canonical_payload_hash}</span>
          </DetailRow>
          {order.soroban_contract_id ? (
            <DetailRow label="Contrato">
              <a
                href={contractExplorerUrl(config.explorerBaseUrl, order.soroban_contract_id)}
                target="_blank"
                rel="noreferrer"
              >
                ver no explorer ↗
              </a>
            </DetailRow>
          ) : null}
        </div>
      </div>

      <div className="card">
        {isPaid ? (
          <div>
            <div className="alert alert-success">✓ Pagamento confirmado on-chain.</div>
            {txHash ? (
              <a
                href={txExplorerUrl(config.explorerBaseUrl, txHash)}
                target="_blank"
                rel="noreferrer"
              >
                Ver transação no explorer ↗
              </a>
            ) : null}
          </div>
        ) : null}

        {awaitingRegistration && !isPaid ? (
          <div>
            <p className="muted">A cobrança está sendo registrada no contrato. Aguarde…</p>
            <button className="btn" onClick={refresh}>
              Atualizar status
            </button>
          </div>
        ) : null}

        {isTerminal ? (
          <p className="muted">Esta cobrança não está mais disponível para pagamento.</p>
        ) : null}

        {isActive && !isPaid ? (
          <div className="stack">
            {!wallet ? (
              <button
                className="btn btn-primary btn-block"
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? <span className="spinner" /> : null}
                Conectar carteira (Freighter)
              </button>
            ) : (
              <>
                <DetailRow label="Pagando com">
                  <span className="mono">{wallet}</span>
                </DetailRow>
                <button className="btn btn-primary btn-block" onClick={onPay} disabled={paying}>
                  {paying ? <span className="spinner" /> : null}
                  Pagar {formatAssetAmount(order.amount, order.asset_code)}
                </button>
              </>
            )}
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Não custodial: a transação é assinada na sua carteira. Sua chave secreta nunca é
              enviada ao servidor.
            </p>
          </div>
        ) : null}

        {payError ? <div className="alert alert-error">{payError}</div> : null}
        {loadError ? <div className="alert alert-error">{loadError}</div> : null}
      </div>
    </main>
  );
}
