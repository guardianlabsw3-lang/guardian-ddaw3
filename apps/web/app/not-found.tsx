import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container container-narrow">
      <div className="card">
        <h1>Não encontrado</h1>
        <p className="muted">A cobrança ou página solicitada não existe.</p>
        <Link href="/">← Voltar ao início</Link>
      </div>
    </main>
  );
}
