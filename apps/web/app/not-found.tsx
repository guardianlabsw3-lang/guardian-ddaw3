'use client';

import Link from 'next/link';
import { useI18n } from '@/src/i18n/LanguageProvider';
import { BrandLogo } from '@/src/components/BrandLogo';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="container container-narrow">
      <div className="toolbar">
        <BrandLogo size={34} />
      </div>
      <div className="card">
        <h1>{t('notFound.title')}</h1>
        <p className="muted">{t('notFound.subtitle')}</p>
        <Link href="/">{t('notFound.back')}</Link>
      </div>
    </main>
  );
}
