'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { PaymentOrder, Tenant } from '@/src/lib/types';
import { newIdempotencyKey } from '@/src/auth/session';
import { DatePicker } from '@/src/components/DatePicker';
import { useI18n } from '@/src/i18n/LanguageProvider';

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
  const { t } = useI18n();
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
      .catch(() => setError(t('createOrder.errorLoadTenants')));
  }, [api, t]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenants, tenantId],
  );

  const walletMissing = selectedTenant !== null && !selectedTenant.stellar_wallet_public_key;

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTenant) return;
    if (dueDate && dueDate < todayIso) {
      setError(t('createOrder.errorDueDate'));
      return;
    }
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
      setError(err instanceof ApiError ? err.message : t('createOrder.errorSubmit'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="tenant">{t('createOrder.tenant')}</label>
        <select id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
          <option value="">{t('common.select')}</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} ({tenant.document_number})
            </option>
          ))}
        </select>
      </div>

      {selectedTenant ? (
        <div className="field">
          <label>{t('createOrder.walletLabel')}</label>
          <input
            readOnly
            value={selectedTenant.stellar_wallet_public_key ?? t('createOrder.noWallet')}
          />
        </div>
      ) : null}

      {walletMissing ? (
        <div className="alert alert-error">{t('createOrder.walletMissing')}</div>
      ) : null}

      <div className="field">
        <label htmlFor="amount">{t('createOrder.amount')}</label>
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
          {t('createOrder.asset', {
            default: selectedTenant?.default_asset_code ?? t('createOrder.assetDefaultFallback'),
          })}
        </label>
        <input
          id="asset"
          value={assetCode}
          onChange={(e) => setAssetCode(e.target.value)}
          placeholder="XLM"
        />
      </div>

      <div className="field">
        <label htmlFor="due">{t('createOrder.due')}</label>
        <DatePicker id="due" value={dueDate} onChange={setDueDate} min={todayIso} />
      </div>

      <div className="field">
        <label htmlFor="desc">{t('createOrder.description')}</label>
        <input
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('createOrder.descriptionPlaceholder')}
        />
      </div>

      <div className="field">
        <label htmlFor="ext">{t('createOrder.externalId')}</label>
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
        {t('createOrder.submit')}
      </button>
    </form>
  );
}
