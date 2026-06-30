'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayOrderApi } from '@/src/lib/api';
import { ApiError } from '@/src/lib/api';
import type { Tenant } from '@/src/lib/types';
import { truncateMiddle } from '@/src/lib/format';

function WalletEditor({
  tenant,
  api,
  onSaved,
}: {
  tenant: Tenant;
  api: PayOrderApi;
  onSaved: (tenant: Tenant) => void;
}) {
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
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar a wallet.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        {tenant.stellar_wallet_public_key ? 'editar' : 'cadastrar'}
      </button>
    );
  }

  return (
    <div className="stack" style={{ minWidth: 280 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="G... (chave pública Stellar Testnet)"
        spellCheck={false}
      />
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="inline">
        <button className="btn btn-primary" onClick={save} disabled={saving || value.trim() === ''}>
          {saving ? <span className="spinner" /> : null}
          Salvar
        </button>
        <button className="btn" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function TenantsPanel({ api }: { api: PayOrderApi }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTenants(await api.listTenants());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar tenants.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function onTenantSaved(updated: Tenant) {
    setTenants((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Tenants</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Atualizar
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="muted">Carregando…</p> : null}

      {!loading && tenants.length === 0 ? <p className="muted">Nenhum tenant cadastrado.</p> : null}

      {tenants.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Documento</th>
              <th>Status</th>
              <th>Wallet destino</th>
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
                  <span className={`badge ${tenant.status === 'ACTIVE' ? 'success' : 'neutral'}`}>
                    {tenant.status}
                  </span>
                </td>
                <td>
                  <div className="stack">
                    <span className="mono">
                      {tenant.stellar_wallet_public_key
                        ? truncateMiddle(tenant.stellar_wallet_public_key, 8, 8)
                        : '— não cadastrada —'}
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
