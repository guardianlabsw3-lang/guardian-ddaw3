# `@payorder/web` — Frontend (Next.js)

Placeholder for the PayOrder W3 Guardian frontend (public payment page + admin panel). The
implementation lands from **TASK-025** onward.

The non-custodial payment flow signs transactions in the browser via Stellar Wallets Kit;
the backend never sees the payer seed. Shared zod schemas and the canonical hash come from
[`@payorder/shared`](../../packages/shared/README.md).
