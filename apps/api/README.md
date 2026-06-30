# `@payorder/api` — Backend

PayOrder W3 Guardian REST API. **Phase 2 (TASK-010..015)** ships the framework-free core —
domain, application use cases and PostgreSQL/Drizzle persistence. **Phase 3 (TASK-016..017)**
adds the Soroban adapter and on-chain workers. **Phase 4 (TASK-018..024)** adds the REST API:
a deliberately thin, **framework-free HTTP edge** (a small router over `node:http`), admin JWT
+ API-key auth, idempotency, rate limiting, CORS, signed webhooks, audit and observability,
plus the OpenAPI contract.

Architecture and layering follow
[`docs/specs/payorder-w3-guardian/04-architecture.md`](../../docs/specs/payorder-w3-guardian/04-architecture.md):

```text
src/
  domain/                     entities, VOs, state machine, events — framework free
    shared/                   DomainError, Money
    tenant/                   Tenant aggregate + events
    payment-order/            PaymentOrder aggregate, status machine, source, events
  application/                use cases + ports (depend only on the domain)
    ports/                    TenantRepository, PaymentOrderRepository, Clock, IdGenerator,
                              SlugGenerator, OrderRegistrationQueue
    shared/                   ApplicationError + zod validation helper
    tenant/                   CreateTenant, Get/List, Activate/Deactivate, Assign/GetWallet
    payment-order/            CreatePaymentOrder (multi-origin), input schema, views
  infrastructure/
    config/                   env loading + validation (zod), Testnet-locked
    persistence/              Drizzle schema, migrations, mappers, repositories, migrator
    adapters/                 SystemClock, UuidV7IdGenerator, Base58SlugGenerator
    queue/                    in-memory + BullMQ OrderRegistrationQueue producer
    auth/                     argon2id hasher, HS256 JWT, API-key mint/verify, repositories
    idempotency/              Drizzle-backed Idempotency-Key store
    ratelimit/                in-memory fixed-window rate limiter
    webhooks/                 HMAC signer, fetch sender, delivery repository
    audit/                    Drizzle audit-log writer
    observability/            console logger, DB/Redis/RPC readiness checks
  interfaces/http/            framework-free HTTP edge (TASK-018..023)
    router, app, server       node:http router + middleware pipeline + server adapter
    middleware/               request-id, security headers, CORS, auth, rate-limit, idempotency
    dto.ts                    snake_case wire ⇆ camelCase use-case mapping (spec 08)
    tenant/ payment-order/    controllers wiring use cases to routes
    public/ auth/ health/     public query, admin login, /health + /ready
  container.ts                composition root (buildApiContainer)
  main.ts                     server entrypoint (graceful shutdown)
```

Shared types, zod schemas, Stellar value objects and canonicalization/hash come from
[`@payorder/shared`](../../packages/shared/README.md).

## What's implemented (Phase 2)

- **Domain (TASK-010):** `Tenant` and `PaymentOrder` aggregates, the order state machine
  (`CREATED → ACTIVE → PAID/EXPIRED/CANCELLED/FAILED`), `Money`, domain events. The
  `PaymentOrder.create` factory copies the receiver wallet (RN-03) and computes the
  canonical-payload SHA-256 hash via `@payorder/shared` (RN-04).
- **Config (TASK-011):** `loadConfig()` validates the environment and **refuses to boot**
  on anything other than Stellar Testnet (network name and passphrase).
- **Persistence (TASK-012/013):** Drizzle schema for every table in `09-data-model`,
  versioned migrations, mappers and repositories (`Tenant`, `PaymentOrder` + events) with
  the `(tenant_id, external_id)` idempotency constraint.
- **Use cases (TASK-014/015):** tenant onboarding/wallet/status, and `CreatePaymentOrder`
  — one flow for panel/API/ERP origins, automatic wallet resolution, manual wallet
  rejection (RN-02), and idempotency by `(tenant_id, external_id)`.

## What's implemented (Phase 4 — TASK-018..024)

- **Endpoints (TASK-018/019):** tenants CRUD + activation + wallet; payment orders
  create/list/get/status/events/cancel + webhook resend; `GET /api/public/payment-orders/{slug}`
  (no sensitive data, masked document). Wire format is **snake_case** per spec 08; the error
  envelope is standardized (`{ error: { code, message, request_id, details } }`).
- **Auth (TASK-020):** admin login issuing an HS256 JWT over **argon2id** password hashes;
  integrator **API keys** (`X-Api-Key`) with scopes and an optional tenant allowlist. Routes
  declare `auth`/`scopes`; the middleware enforces `401`/`403` (`FORBIDDEN_SCOPE`,
  `FORBIDDEN_TENANT`).
- **Idempotency / rate limit / CORS (TASK-021):** required `Idempotency-Key` on order
  creation (replay returns the stored response; divergent body → `409`), per principal/IP
  fixed-window limiting (`429` + `Retry-After`), and a strict CORS allowlist (never `*`).
- **Webhooks (TASK-022):** HMAC-signed payloads (`X-PayOrder-Signature: t=…,v1=…`), every
  attempt persisted in `webhook_deliveries`, exponential backoff (1m/5m/30m/2h/6h) retried by
  the worker, and a manual resend endpoint.
- **Audit / observability (TASK-023):** critical actions written to `audit_logs` with a
  sanitized diff; `X-Request-Id` correlation on every response/log; `/health` (liveness) and
  `/ready` (DB/Redis/Soroban-RPC checks → `503` when degraded).
- **OpenAPI (TASK-024):** [`openapi/payorder-api.yaml`](../../openapi/payorder-api.yaml) is the
  contract; a vitest contract test validates the document and asserts it matches the
  implemented routes exactly (CI fails on drift).

## Scripts

```bash
npm run -w @payorder/api typecheck      # tsc --noEmit
npm run -w @payorder/api build          # tsc → dist
npm run -w @payorder/api start          # node dist/main.js (needs a full env)
npm run -w @payorder/api dev            # tsx watch src/main.ts
npm run -w @payorder/api test           # vitest (unit always; integration needs DATABASE_URL)
npm run -w @payorder/api db:generate    # drizzle-kit generate (see note below)
npm run -w @payorder/api db:migrate     # apply migrations (needs a full env)
```

Copy [`.env.example`](./.env.example) to `.env` and fill it in. Migrations apply against any
PostgreSQL 16 reachable via `DATABASE_URL`.

### Tests

Unit tests (domain, use cases, config) run everywhere. Repository/end-to-end tests
(`test/*.it.test.ts`) need a real PostgreSQL and **skip themselves** unless `DATABASE_URL`
is set:

```bash
DATABASE_URL=postgres://payorder:payorder@localhost:5432/payorder npm run -w @payorder/api test
```

> **Migrations note:** the source uses NodeNext `.js` import specifiers, which `drizzle-kit`'s
> loader cannot resolve directly. The committed migration in
> `src/infrastructure/persistence/migrations` is generated; to regenerate after a schema
> change, run `drizzle-kit generate` against a copy of `schema/` with the `.js` specifiers
> stripped (the SQL/snapshot output is identical either way).
