import { expect, test } from '@playwright/test';

/**
 * Admin panel (TASK-026). Validates the login gate and that manual charge creation never
 * exposes a wallet text field — the destination wallet is loaded read-only from the tenant.
 */
test('shows the login gate before granting access', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
});

test('manual charge form loads the tenant wallet read-only', async ({ page }) => {
  // Seed an admin token so the dashboard renders (API must be reachable for live data).
  await page.addInitScript(() => {
    window.localStorage.setItem('payorder.admin.token', 'e2e-token');
  });
  await page.goto('/admin');

  await page.getByRole('button', { name: 'Cobranças' }).click();
  await page.getByRole('button', { name: 'Nova cobrança' }).click();

  await expect(page.getByText('Tenant destino')).toBeVisible();
  // The wallet input is read-only — it is never typed by the operator.
  const wallet = page.locator('input[readonly]');
  await expect(wallet).toHaveCount(1);
});
