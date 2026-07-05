'use client';

import { useI18n } from '@/src/i18n/LanguageProvider';

/** Toggles between pt-BR (default) and English; shows the code of the language currently active. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <button
      type="button"
      className={className ? `${className} lang-switch` : 'lang-switch'}
      onClick={() => setLocale(locale === 'pt' ? 'en' : 'pt')}
      aria-label="Toggle language"
    >
      {locale === 'pt' ? 'EN' : 'PT'}
    </button>
  );
}
