'use client';

import Link from 'next/link';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { LanguageSwitch } from '@/src/components/LanguageSwitch';
import { BrandLogo } from '@/src/components/BrandLogo';

export default function HomePage() {
  const { t } = useI18n();
  return (
    <main className="container container-narrow">
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          <BrandLogo size={42} suffix="Guardian" />
        </h1>
        <LanguageSwitch />
      </div>
      <p className="muted">{t('home.subtitle', { network: 'Stellar Testnet' })}</p>

      <div className="card">
        <h2>{t('home.pagesTitle')}</h2>
        <div className="stack">
          <Link href="/admin">{t('home.adminLink')}</Link>
          <span className="muted">
            {t('home.publicPageNotePrefix')} <span className="mono">/p/&lt;slug&gt;</span>{' '}
            {t('home.publicPageNoteSuffix')}
          </span>
        </div>
      </div>
    </main>
  );
}
