'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { PaymentOrder, Tenant } from '@/src/lib/types';
import { newIdempotencyKey } from '@/src/auth/session';

/**
 * Manual charge creation (UC-03, spec 16 §3). The destination wallet is **never typed** — on
 * selecting a tenant the form auto-loads and shows the registered wallet read-only, and the
 * wallet is not part of the request (the API copies it from the tenant — RN-02).
 */
export function CreateOrderForm({
  api,
  onCreated,
}: {
  api: PayOrderApi;
  onCreated: (order: PaymentOrder) => void;
}) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [amount, setAmount] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [externalId, setExternalId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listTenants()
      .then(setTenants)
      .catch(() => setError('Falha ao carregar tenants.'));
  }, [api]);

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === tenantId) ?? null,
    [tenants, tenantId],
  );

  const walletMissing = selectedTenant !== null && !selectedTenant.stellar_wallet_public_key;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTenant) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createOrder({
        tenant_id: selectedTenant.id,
        amount: amount.trim(),
        asset_code: assetCode.trim() || undefined,
        due_date: dueDate || undefined,
        description: description.trim() || undefined,
        external_id: externalId.trim() || undefined,
        idempotencyKey: newIdempotencyKey(),
      });
      onCreated(order);
      setAmount('');
      setDescription('');
      setExternalId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar a cobrança.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="tenant">Tenant destino</label>
        <select id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
          <option value="">Selecione…</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} ({tenant.document_number})
            </option>
          ))}
        </select>
      </div>

      {selectedTenant ? (
        <div className="field">
          <label>Wallet destino (carregada do tenant — somente leitura)</label>
          <input
            readOnly
            value={selectedTenant.stellar_wallet_public_key ?? '— tenant sem wallet cadastrada —'}
          />
        </div>
      ) : null}

      {walletMissing ? (
        <div className="alert alert-error">
          O tenant selecionado não possui wallet cadastrada. Cadastre a wallet na aba Tenants antes
          de criar a cobrança.
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="amount">Valor</label>
        <input
          id="amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="150.00"
          inputMode="decimal"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="asset">
          Asset (opcional — padrão: {selectedTenant?.default_asset_code ?? 'do tenant'})
        </label>
        <input
          id="asset"
          value={assetCode}
          onChange={(e) => setAssetCode(e.target.value)}
          placeholder="XLM"
        />
      </div>

      <div className="field">
        <label htmlFor="due">Vencimento (opcional)</label>
        <input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="desc">Descrição (opcional)</label>
        <input
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Cobrança gerada no painel"
        />
      </div>

      <div className="field">
        <label htmlFor="ext">External ID (opcional)</label>
        <input
          id="ext"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="ORDER-123456"
        />
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <button
        className="btn btn-primary"
        type="submit"
        disabled={submitting || !selectedTenant || walletMissing || amount.trim() === ''}
      >
        {submitting ? <span className="spinner" /> : null}
        Criar cobrança
      </button>
    </form>
  );
}
