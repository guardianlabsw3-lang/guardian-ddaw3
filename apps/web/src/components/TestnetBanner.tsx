'use client';

import { useI18n } from '@/src/i18n/LanguageProvider';

export function TestnetBanner() {
  const { t } = useI18n();
  return (
    <div className="banner" role="note">
      ⚠️ {t('banner.testnet', { network: 'TESTNET' })}
    </div>
  );
}
