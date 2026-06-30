# `@payorder/api` — Backend (NestJS)

PayOrder W3 Guardian REST API. **Phase 2 (TASK-010..015)** ships the framework-free core —
domain, application use cases and PostgreSQL/Drizzle persistence. HTTP interfaces (NestJS),
the Stellar/Soroban adapters and the worker land in later phases.

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
    queue/                    in-memory OrderRegistrationQueue (BullMQ adapter: TASK-016)
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

## Scripts

```bash
npm run -w @payorder/api typecheck      # tsc --noEmit
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
