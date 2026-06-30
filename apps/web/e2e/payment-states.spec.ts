import { expect, test, type Page } from '@playwright/test';

/**
 * Public payment page — lifecycle UI guards (TASK-030, spec 11 §8 step 8/9). Complements
 * `public-payment.spec.ts` (which checks the few-clicks ACTIVE flow) by asserting the
 * terminal states: a PAID order shows confirmation and offers **no** pay action (a duplicate
 * payment is impossible from the UI), and EXPIRED/CANCELLED orders are not payable.
 *
 * The public order endpoint is stubbed via route interception, so this runs against just the
 * web server (no API/Testnet). The page re-fetches client-side on "Atualizar", so we drive
 * the stub through that refresh path and assert the rendered state.
 */

const SLUG = 'p_state_demo';
const WALLET = 'GB2JSQ55C76FBGEA4SJ6J4AQUWMNXEB25GVLK6W5CVEEJRUG2UCK4KUZ';
const CONTRACT = 'CCONTRACT000000000000000000000000000000000000000000000000';
const HASH = 'a'.repeat(64);

function stubOrder(status: string, withContract = true) {
  return {
    status,
    network: 'TESTNET',
    receiver: {
      name: 'ACME Pagamentos',
      document: '**.***.333/0***-**',
      wallet_public_key: WALLET,
    },
    amount: '150.0000000',
    asset_code: 'XLM',
    asset_issuer: null,
    due_date: null,
    order_id: '00000000-0000-7000-8000-000000000001',
    canonical_payload_hash: HASH,
    soroban_contract_id: withContract ? CONTRACT : null,
    explorer_url: withContract
      ? `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`
      : null,
  };
}

/** Stub the public order endpoint, open the page, and ensure the order is rendered. */
async function openWithStubbedOrder(page: Page, body: ReturnType<typeof stubOrder>): Promise<void> {
  await page.route('**/api/public/payment-orders/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  await page.goto(`/p/${SLUG}`);

  // If server-side rendering could not reach the API, the page shows a retry fallback; the
  // "Atualizar" button re-fetches client-side, which our stub answers.
  const refresh = page.getByRole('button', { name: 'Atualizar' });
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click();
  }
  await expect(page.getByRole('heading', { name: 'Pagar cobrança' })).toBeVisible();
}

test('an ACTIVE order offers a wallet connection', async ({ page }) => {
  await openWithStubbedOrder(page, stubOrder('ACTIVE'));

  await expect(page.getByRole('button', { name: /Conectar carteira/ })).toBeVisible();
  await expect(page.getByText('Pagamento confirmado on-chain.')).toHaveCount(0);
});

test('a PAID order shows confirmation and never offers a pay action (no double payment)', async ({
  page,
}) => {
  await openWithStubbedOrder(page, stubOrder('PAID'));

  await expect(page.getByText('Pagamento confirmado on-chain.')).toBeVisible();
  // The few-clicks pay path is gone once paid — the order cannot be paid twice from the UI.
  await expect(page.getByRole('button', { name: /Conectar carteira/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pagar/ })).toHaveCount(0);
});

test('an EXPIRED order is not payable', async ({ page }) => {
  await openWithStubbedOrder(page, stubOrder('EXPIRED'));

  await expect(page.getByText('não está mais disponível para pagamento')).toBeVisible();
  await expect(page.getByRole('button', { name: /Conectar carteira/ })).toHaveCount(0);
});
