'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { Tenant } from '@/src/lib/types';
import { truncateMiddle } from '@/src/lib/format';
import { useI18n } from '@/src/i18n/LanguageProvider';

function WalletEditor({
  tenant,
  api,
  onSaved,
}: {
  tenant: Tenant;
  api: PayOrderApi;
  onSaved: (tenant: Tenant) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(tenant.stellar_wallet_public_key ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTenantWallet(tenant.id, value.trim());
      onSaved(updated);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenants.errorSaveWallet'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        {tenant.stellar_wallet_public_key ? t('tenants.edit') : t('tenants.register')}
      </button>
    );
  }

  return (
    <div className="stack" style={{ minWidth: 280 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('tenants.walletPlaceholder')}
        spellCheck={false}
      />
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="inline">
        <button className="btn btn-primary" onClick={save} disabled={saving || value.trim() === ''}>
          {saving ? <span className="spinner" /> : null}
          {t('common.save')}
        </button>
        <button className="btn" onClick={() => setOpen(false)} disabled={saving}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function ActivateButton({
  tenant,
  api,
  onActivated,
}: {
  tenant: Tenant;
  api: PayOrderApi;
  onActivated: (tenant: Tenant) => void;
}) {
  const { t } = useI18n();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setActivating(true);
    setError(null);
    try {
      onActivated(await api.activateTenant(tenant.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenants.errorActivate'));
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="stack">
      <button className="btn btn-primary" onClick={activate} disabled={activating}>
        {activating ? <span className="spinner" /> : null}
        {t('tenants.activate')}
      </button>
      {error ? <div className="alert alert-error">{error}</div> : null}
    </div>
  );
}

export function TenantsPanel({ api }: { api: PayOrderApi }) {
  const { t } = useI18n();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTenants(await api.listTenants());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenants.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function onTenantSaved(updated: Tenant) {
    setTenants((current) => current.map((tenant) => (tenant.id === updated.id ? updated : tenant)));
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>{t('tenants.title')}</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {t('common.updating')}
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="muted">{t('common.loading')}</p> : null}

      {!loading && tenants.length === 0 ? <p className="muted">{t('tenants.empty')}</p> : null}

      {tenants.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t('tenants.colName')}</th>
              <th>{t('tenants.colDocument')}</th>
              <th>{t('tenants.colStatus')}</th>
              <th>{t('tenants.colWallet')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td>
                  {tenant.name}
                  <br />
                  <span className="muted mono">{tenant.slug}</span>
                </td>
                <td>
                  {tenant.document_type} {tenant.document_number}
                </td>
                <td>
                  <div className="stack">
                    <span className={`badge ${tenant.status === 'ACTIVE' ? 'success' : 'neutral'}`}>
                      {tenant.status}
                    </span>
                    {tenant.status !== 'ACTIVE' ? (
                      <ActivateButton tenant={tenant} api={api} onActivated={onTenantSaved} />
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="stack">
                    <span className="mono">
                      {tenant.stellar_wallet_public_key
                        ? truncateMiddle(tenant.stellar_wallet_public_key, 8, 8)
                        : t('common.notRegistered')}
                    </span>
                    <WalletEditor tenant={tenant} api={api} onSaved={onTenantSaved} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
