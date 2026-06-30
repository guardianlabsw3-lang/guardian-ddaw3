import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the web E2E suite (TASK-025/026, run via `npm run e2e`). Not part of
 * the root CI typecheck/test (it needs a running API + a browser wallet); install Playwright
 * with `npx playwright install` before running locally.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
