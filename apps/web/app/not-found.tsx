'use client';

import Link from 'next/link';
import { useI18n } from '@/src/i18n/LanguageProvider';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="container container-narrow">
      <div className="card">
        <h1>{t('notFound.title')}</h1>
        <p className="muted">{t('notFound.subtitle')}</p>
        <Link href="/">{t('notFound.back')}</Link>
      </div>
    </main>
  );
}
