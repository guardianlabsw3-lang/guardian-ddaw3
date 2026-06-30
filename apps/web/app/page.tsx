import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container container-narrow">
      <h1>PayOrder W3 Guardian</h1>
      <p className="muted">
        Cobranças estruturadas (DDA) liquidadas na <strong>Stellar Testnet</strong>. Pagamento não
        custodial: o pagador assina no próprio navegador e a chave secreta nunca chega ao backend.
      </p>

      <div className="card">
        <h2>Páginas</h2>
        <div className="stack">
          <Link href="/admin">→ Painel administrativo</Link>
          <span className="muted">
            A página pública de pagamento é acessada pelo link{' '}
            <span className="mono">/p/&lt;slug&gt;</span> gerado ao criar uma cobrança.
          </span>
        </div>
      </div>
    </main>
  );
}
