# @payorder/web

Frontend of **PayOrder W3 Guardian** — Next.js (App Router). Implements the public
non-custodial payment page (TASK-025) and the admin panel (TASK-026). Testnet only.

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing with links to the admin panel. |
| `/p/[slug]` | **Public payment page.** Loads a charge by its `public_payment_slug`, connects the payer's wallet (Freighter), and signs + submits the contract `pay` on the client. The payer's seed never reaches the backend. Shows destination, amount, canonical hash, status and an explorer link. |
| `/admin` | **Admin panel.** Login (JWT), list tenants, register/edit a tenant's destination wallet, create a manual charge (wallet auto-loaded read-only from the tenant — never typed), list charges, view status and payment events. |

## How the non-custodial payment works

1. The page fetches public data from `GET /api/public/payment-orders/{slug}`.
2. The payer connects **Freighter** (`@stellar/freighter-api`) — we receive only a public key.
3. We build the contract `pay(order_id, payer, amount, asset)` invocation (`src/stellar/*`),
   using the same `ScVal` encoding as the API adapter so it matches the registered order.
4. The transaction is simulated/prepared via Soroban RPC, **signed in the wallet**, submitted,
   and polled to confirmation. The seed never leaves the browser extension.

## Configuration

Copy `.env.example`. Only `NEXT_PUBLIC_*` vars are exposed to the browser:

- `NEXT_PUBLIC_API_BASE_URL` — PayOrder REST API base (no trailing slash).
- `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC_URL` — Stellar Testnet endpoints.
- `NEXT_PUBLIC_EXPLORER_BASE_URL` — explorer base for links.

## Scripts

```bash
npm run dev --workspace @payorder/web        # local dev server
npm run build --workspace @payorder/web      # production build
npm run typecheck --workspace @payorder/web  # tsc --noEmit
npm run test --workspace @payorder/web       # vitest unit tests (pure logic)
npm run e2e --workspace @payorder/web        # Playwright E2E (needs `npx playwright install`)
```

Unit tests cover the pure building blocks (formatting, `ScVal` encoding, transaction
building, the API client). The Playwright suite in `e2e/` covers the user flows and is run
out of CI (it needs a running API and a browser wallet). Shared zod schemas, Stellar value
objects and the canonical hash come from [`@payorder/shared`](../../packages/shared/README.md).
