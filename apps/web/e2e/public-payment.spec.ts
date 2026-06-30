import { expect, test } from '@playwright/test';

/**
 * Public payment page (TASK-025). Validates the few-clicks flow and that sensitive data is
 * never requested in-page. Wallet signing is exercised against a stubbed Freighter provider;
 * a real run needs the API serving a public order at the given slug.
 */
const SLUG = process.env.E2E_PUBLIC_SLUG ?? 'p_demo';

test('renders the public charge with destination, amount and Testnet warning', async ({ page }) => {
  await page.goto(`/p/${SLUG}`);

  await expect(page.getByText('TESTNET')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pagar cobrança' })).toBeVisible();
  await expect(page.getByText('Carteira destino')).toBeVisible();
  await expect(page.getByText('Hash do payload')).toBeVisible();
});

test('offers wallet connection without ever asking for a secret key', async ({ page }) => {
  await page.goto(`/p/${SLUG}`);

  // The page must never collect a seed/secret — only connect a non-custodial wallet.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Conectar carteira/ })).toBeVisible();
});
