# `@payorder/worker` — Background Worker (BullMQ)

Background processor for PayOrder W3 Guardian. It connects the off-chain records to the
on-chain authority (the Soroban PayOrder contract) using BullMQ queues on Redis. Implemented
in **TASK-016..017**.

It reuses the api's framework-free use cases, the Drizzle `PaymentOrderRepository`, the
`SorobanContractAdapter` and the env loader via [`@payorder/api`](../api), and shares
canonicalization/hash and the on-chain reference derivation via
[`@payorder/shared`](../../packages/shared/README.md) so the order hash and ids are identical
across services.

## Responsibilities

| Job | Trigger | Use case | Effect |
|-----|---------|----------|--------|
| `register-order` (`src/jobs/register-order.ts`) | queue (api producer) | `RegisterOrderOnChain` | `register_order` on-chain, then `CREATED → ACTIVE`. Idempotent; retries with backoff; moves to `FAILED` once attempts are exhausted. |
| `sync-status` (`src/jobs/sync-status.ts`) | repeatable | `SyncOrderStatus` | Reads `get_order` for each `ACTIVE` order and reflects `PAID`/`CANCELLED`/`EXPIRED` off-chain. Divergences are logged. |
| `expire-orders` (`src/jobs/expire-orders.ts`) | repeatable | `ExpireOrders` | Transitions overdue `ACTIVE` orders to `EXPIRED` (UC-09), using an injectable clock. |

`register-order` is event-driven: the api enqueues a job after persisting a `CREATED` order
(`BullmqOrderRegistrationQueue`). `sync-status` and `expire-orders` are repeatable jobs on a
`maintenance` queue, so their schedule lives durably in Redis and survives restarts.

## Idempotency & retries (TASK-016)

The on-chain registration is at-least-once: BullMQ retries failed jobs with exponential
backoff (`REGISTER_ORDER_JOB_OPTIONS` in `@payorder/api`). `RegisterOrderOnChain` is
idempotent — a re-run for an order that is already `ACTIVE` (or registered on-chain) is a
no-op — so retries are safe. When a job exhausts its attempts the order is moved to `FAILED`
rather than left stuck in `CREATED`.

## Reconciliation (TASK-017)

The contract is the source of truth for the payment status (spec 07). `SyncOrderStatus` never
forces a state it can't justify: when an order is `ACTIVE` off-chain but absent or divergent
on-chain, the divergence is **logged** for an operator instead of being applied.

## Configuration

See [`.env.example`](./.env.example). Beyond the shared (Testnet-locked) api schema, the
worker **requires** `SOROBAN_CONTRACT_ID` and `SOROBAN_ADMIN_SECRET`, and accepts optional
`SYNC_INTERVAL_MS` / `EXPIRE_INTERVAL_MS`.

## Scripts

```bash
npm run dev   --workspace @payorder/worker   # tsx watch
npm run build --workspace @payorder/worker   # tsc → dist
npm run start --workspace @payorder/worker   # node dist/index.js
```
