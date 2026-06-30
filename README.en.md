# PayOrder W3 Guardian

> **Structured Payment DDA on Web3** — turn digital charges into verifiable Web3 payment
> orders on the **Stellar Testnet**, with an immutable record on a **Soroban** smart contract.

🌐 **Languages / Idiomas:** **English (this document)** · **[Português](README.md)**

This README is a high-level overview. The full Spec-Driven-Design specification lives in
[`docs/specs/payorder-w3-guardian/`](docs/specs/payorder-w3-guardian/README.md) and should
be read in numeric order.

## 1. What is PayOrder W3 Guardian?

**PayOrder W3 Guardian** is a Web3 charging rail by **Guardian Labs**. It receives charges
from **multiple origins** (admin panel, internal API, ERP, future integrations) and converts
them into **payment orders that are verifiable on-chain** and paid directly between Stellar
wallets.

It exists to **transform digital charges into verifiable Web3 payment orders**, where:

- the destination is clear and unambiguous;
- the amount is visually confirmed by the payer before paying;
- the charge has an immutable record on the blockchain;
- the payment goes directly from the payer's wallet to the receiving tenant's wallet
  (**non-custodial**).

> **MVP scope:** runs **only on Stellar Testnet**. Mainnet is a planned future evolution.

## 2. The problem it solves

Traditional digital charges (payment links, invoices, proposals) suffer from **ambiguity and
low trust in the destination**:

1. **Opaque destination** — the payer can rarely verify reliably *who* is receiving and *to
   which account/wallet* the money goes.
2. **Data tampering** — amount, recipient or banking data can be altered in transit
   (phishing, man-in-the-middle, payment-slip fraud).
3. **No verifiable proof** — there is no public, immutable record that a charge was issued
   with given parameters.
4. **Destination typos** — when the destination wallet/account is typed manually at charge
   time, it opens the door to human error and fraud.

PayOrder W3 Guardian attacks each of these:

- The **destination wallet is never typed when creating a charge.** It is resolved
  automatically from the **previously registered tenant**, eliminating human error and
  malicious destination swapping.
- The relevant charge data is **serialized into a canonical payload** and its **SHA-256 hash**
  is registered on the Soroban contract — any divergence is detectable.
- Before paying, the payer sees: **who receives, which wallet, which amount, which asset, the
  status, and the on-chain registration proof**.
- The payment is **non-custodial**: the payer's wallet signs directly in the frontend; the
  payer's private seed **never** passes through the backend.

## 3. Core proposal & value

| Audience | Value |
|----------|-------|
| **Receiver (tenant)** | Receive Web3 payments without manually exposing the wallet on every charge, with the destination always correct and an auditable record. |
| **Payer** | Full trust in the destination before paying; few-clicks experience; public on-chain proof. |
| **Guardian Labs** | A reusable charging component that can be plugged into other products (checkout, payment links, commercial proposals) without coupling to a specific product. |

The product is **origin-agnostic**: every charge is born from one origin (panel, API, ERP,
future integrations) but follows the **same internal flow** of tenant → wallet → order →
on-chain registration. A `metadata.source` field identifies the origin for auditing.

## 4. What the payer can verify

Before confirming a payment, the payer can visually confirm:

- **who is receiving** (name / legal name, document when applicable);
- **which Stellar Testnet wallet** will receive the payment;
- **which amount** will be transferred;
- **which asset** will be used;
- **the order status** (`ACTIVE`, `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`);
- **whether the order is still active**;
- **whether the charge was correctly registered on the blockchain** (order id, hash,
  contract id, link to the Testnet explorer).

## 5. Guiding principles

| Principle | How it is applied |
|-----------|-------------------|
| **Trustworthy destination** | Destination wallet comes from the tenant record, never typed on the charge. |
| **Verifiability** | Canonical hash registered on-chain; public lookup. |
| **Payer non-custody** | Payer's seed never touches the backend; signing happens in the frontend. |
| **Historical preservation** | Destination wallet copied into the Payment Order at creation. |
| **Testnet first** | MVP isolated on Testnet; Mainnet is a future evolution. |
| **MVP simplicity** | Architecture ready to evolve, but a lean scope. |

## 6. Key concepts (ubiquitous language)

| Term | Meaning |
|------|---------|
| **Tenant** | A receiving company/system with a linked Stellar Testnet wallet. |
| **Payment Order** | A charge that becomes a verifiable Web3 payment order. |
| **Receiver Wallet** | The destination wallet, derived from the tenant and **copied** into the order. |
| **Canonical Payload** | A deterministic serialization of the order's relevant data. |
| **Order Hash** | SHA-256 of the canonical payload, registered on-chain. |
| **Public Slug** | An opaque identifier for the public payment link. |
| **Asset** | A `(code, issuer)` pair; for native XLM, `issuer` is null. |

### Canonical payload & hash

The canonical payload is a **deterministic** JSON serialization (lexicographically ordered
keys, no spaces, UTF-8) of the fields that are relevant to payment integrity. The same content
always produces the same hash:

```json
{
  "amount": "150.0000000",
  "asset_code": "XLM",
  "asset_issuer": "",
  "due_date": "2026-07-10",
  "external_id": "ORDER-123456",
  "order_id": "0f9d...",
  "receiver_wallet": "GBPAY...TENANT",
  "tenant_id": "tenant_123",
  "version": 1
}
```

`canonical_payload_hash = SHA256(canonical_json_bytes)` (hex). This hash is registered on-chain
and shown on the public page for verification. The canonicalization function lives in
[`packages/shared`](packages/shared) and is used **identically** by the API, worker and tests
to avoid divergence.

## 7. Payment Order lifecycle

```text
        create()                 registerOnChain()
  ( · ) ─────────▶ CREATED ───────────────────────▶ ACTIVE
                                                       │
                          markPaid()                   │
              PAID ◀──────────────────────────────────┤
                          cancel()                     │
         CANCELLED ◀──────────────────────────────────┤
                          expire()                     │
           EXPIRED ◀──────────────────────────────────┤
                          markFailed()                 │
            FAILED ◀──────────────────────────────────┘
```

| From | To | Trigger | Authority |
|------|----|---------|-----------|
| CREATED | ACTIVE | On-chain registration confirmed | System |
| ACTIVE | PAID | Valid on-chain payment | Payer (via contract) |
| ACTIVE | EXPIRED | `due_date` reached | Worker |
| ACTIVE | CANCELLED | Authorized cancellation | Admin |
| ACTIVE | FAILED | Irreversible registration/payment failure | System |

Terminal states: `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`. `CREATED` is a transient off-chain
state while the order awaits on-chain registration; the public page only enables payment when
the order is `ACTIVE`.

## 8. Architecture

The system follows **Clean Architecture + Hexagonal (Ports & Adapters) + simple DDD**. The
domain sits at the center with no external dependencies; **dependency arrows point inward**.

```text
┌───────────────────────────────────────────────────────────┐
│ Interfaces (HTTP controllers, worker handlers, CLI)        │
│   ┌───────────────────────────────────────────────────┐   │
│   │ Application (use cases, ports, DTOs)               │   │
│   │   ┌───────────────────────────────────────────┐   │   │
│   │   │ Domain (entities, VOs, rules, events)     │   │   │
│   │   └───────────────────────────────────────────┘   │   │
│   └───────────────────────────────────────────────────┘   │
│ Infrastructure (adapters: db, stellar, redis, webhooks)    │
└───────────────────────────────────────────────────────────┘
```

### On-chain / off-chain flow

```text
Origin (panel/API/ERP)
   │
   ▼
Backend API ── resolves tenant ── retrieves tenant wallet
   │                                     │
   ▼            ┌────────────────────────┘
Payment Order (PostgreSQL) ──> canonical payload ──> SHA-256 hash
   │
   ├──> registers order on the Soroban contract (id, hash, tenant, wallet, amount, asset, ACTIVE)
   ▼
Public payment link
   │
   ▼
Payer (non-custodial frontend) ── connects wallet ── confirms ── signs ── pays
   │
   ▼
On-chain transfer (payer wallet → tenant wallet)
   │
   ▼
Contract marks PAID ──> Worker syncs off-chain status ──> webhooks/queries
```

### Source of truth

- The **Soroban contract** is the authority over on-chain payment status
  (`ACTIVE`/`PAID`/`CANCELLED`/`EXPIRED`/`FAILED`).
- **PostgreSQL** is the operational/off-chain source of truth, kept in sync for fast queries,
  listings and integrations.
- The **Worker** reconciles both. On divergence, on-chain prevails for payment status.

## 9. Technology stack

| Component | Technology | Why |
|-----------|------------|-----|
| **Backend API** | Node.js + NestJS + TypeScript | Modularity, native DI, clean boundaries; shares types and canonicalization with the frontend. |
| **Frontend Web** | React + Next.js (App Router) + TypeScript | SSR for the public page, SPA for the admin panel; Stellar Wallets Kit for non-custodial signing. |
| **Smart Contract** | Soroban (Rust) | Stellar's native smart-contract platform; on-chain authority over payment status. |
| **Worker** | Node.js + BullMQ (Redis) | Async jobs: on-chain registration, status sync, expiration, webhook delivery/retry. |
| **Database** | PostgreSQL 16 | Off-chain source of truth. |
| **Cache/Queues** | Redis 7 | Queues, idempotency, rate limiting, cache. |
| **Shared** | `packages/shared` (TypeScript) | zod schemas, types, canonicalization + hash, used by API/web/worker/tests. |

Key backend libraries: `@nestjs/*`, `zod`, `drizzle-orm` (recommended ORM), `@stellar/stellar-sdk`,
`bullmq`, `pino`. Key frontend libraries: `next`, `react`, `@creit.tech/stellar-wallets-kit`,
`@stellar/stellar-sdk`, `@tanstack/react-query`, `zod`, `tailwindcss`.

## 10. Repository layout

```text
apps/
  api/        NestJS backend (domain, application, infrastructure, interfaces)
  web/        Next.js frontend (public payment page + admin panel)
  worker/     BullMQ worker (on-chain sync, expiration, webhooks)
packages/
  shared/     Shared types, zod schemas, canonicalization + hash
contracts/
  payorder/   Soroban smart contract (Rust)
infra/
  docker/     docker-compose for local + VPS (Traefik) deployments
  traefik/    Traefik integration notes
  scripts/    deploy + contract deploy scripts
openapi/      payorder-api.yaml — REST contract
docs/specs/   Full Spec-Driven-Design specification (read in numeric order)
```

## 11. Getting started (local)

The local stack is one command away. Stellar/Soroban talk to the public Testnet via env, so no
chain container is needed.

```bash
make up        # build & start the full local stack (detached)
make migrate   # apply database migrations
make seed      # seed an admin + an active tenant with a wallet
make logs      # follow logs
make down      # stop the stack (keep data)
```

Run `make help` to list all targets. See
[`docs/specs/payorder-w3-guardian/12-docker-local.md`](docs/specs/payorder-w3-guardian/12-docker-local.md)
for details and [`13-docker-vps-traefik.md`](docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md)
for the secure VPS deployment behind an existing Traefik.

## 12. Product invariants (always true)

1. The MVP operates **only on Stellar Testnet**.
2. The **destination wallet is never typed** when creating a charge — it is resolved from the tenant.
3. The tenant's main wallet lives **in the `tenants` table** (no `tenant_wallets` table in the MVP).
4. The destination wallet is **copied into the Payment Order** at creation (history preserved).
5. The system **never** stores the **payer's** private wallet seed.
6. **Boleto Guardian** is out of scope; **ERP is only an example** of a charge origin.

## 13. Roadmap (summary)

- **Phase 0 — Foundations:** SPEC, monorepo & tooling, `packages/shared` (types, schemas, canonicalization + hash).
- **Phase 1 — Soroban contract:** `register_order`, `pay`, `get_order`, `cancel`, `expire`; tests ≥ 85%; Testnet deploy.
- **Phase 2 — Backend core:** domain + persistence + use cases (onboarding, wallet, multi-origin order creation).
- **Phase 3 — On-chain integration:** Soroban adapter, async registration worker, sync/expiration worker, public lookup.
- **Phase 4 — APIs & security:** admin & integration endpoints, auth (JWT + API keys), idempotency, rate limiting, signed webhooks, OpenAPI.
- **Phase 5 — Frontend:** non-custodial public payment page, admin panel, Playwright E2E.
- **Phase 6 — Packaging & deploy:** Docker local + VPS (Traefik), observability.
- **Phase 7 — Hardening & evolution (post-MVP):** Mainnet, multi-asset/issuer, multi-user per tenant, managed custody (Vault/KMS/HSM).

Full roadmap in
[`docs/specs/payorder-w3-guardian/17-roadmap.md`](docs/specs/payorder-w3-guardian/17-roadmap.md).

## 14. Documentation map

| # | Document | Content |
|---|----------|---------|
| 00 | [Purpose](docs/specs/payorder-w3-guardian/00-purpose.md) | Purpose and the problem it solves. |
| 01 | [Product vision](docs/specs/payorder-w3-guardian/01-product-vision.md) | Business and technical vision. |
| 02 | [Requirements](docs/specs/payorder-w3-guardian/02-requirements.md) | MVP scope, out of scope, personas, use cases, FR/NFR, rules. |
| 03 | [Domain model](docs/specs/payorder-w3-guardian/03-domain-model.md) | Aggregates, VOs, states, canonical payload/hash, events, ports. |
| 04 | [Architecture](docs/specs/payorder-w3-guardian/04-architecture.md) | Clean/Hexagonal, stack, modules, ADRs. |
| 05 | [Tenant onboarding](docs/specs/payorder-w3-guardian/05-tenant-onboarding.md) | Fields, flow, validations. |
| 06 | [Wallet management](docs/specs/payorder-w3-guardian/06-wallet-management.md) | Options A/B, recommendation, change rules. |
| 07 | [Soroban contract](docs/specs/payorder-w3-guardian/07-smart-contract.md) | Structures, methods, states, errors, tests. |
| 08 | [REST APIs](docs/specs/payorder-w3-guardian/08-api-contracts.md) | Endpoints, auth, idempotency, webhooks. |
| 09 | [Data model](docs/specs/payorder-w3-guardian/09-data-model.md) | PostgreSQL tables, indexes, constraints. |
| 10 | [Security](docs/specs/payorder-w3-guardian/10-security.md) | Controls and checklist. |
| 11 | [Testing](docs/specs/payorder-w3-guardian/11-testing-strategy.md) | Levels, coverage, E2E, errors. |
| 12 | [Docker local](docs/specs/payorder-w3-guardian/12-docker-local.md) | Local compose, env, commands. |
| 13 | [Docker VPS/Traefik](docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md) | Secure deploy with existing Traefik. |
| 14 | [Deployment](docs/specs/payorder-w3-guardian/14-deployment.md) | Environments, CI/CD, contract, migrations, rollback. |
| 15 | [Observability](docs/specs/payorder-w3-guardian/15-observability.md) | Logs, correlation, metrics, health/ready. |
| 16 | [Integrations](docs/specs/payorder-w3-guardian/16-integrations.md) | Public frontend, panel, manual, API, ERP. |
| 17 | [Roadmap](docs/specs/payorder-w3-guardian/17-roadmap.md) | Technical roadmap by phases. |
| 18 | [Implementation backlog](docs/specs/payorder-w3-guardian/18-implementation-tasks.md) | TASK-001..030 implementable tasks. |

## 15. License

`UNLICENSED` — © Guardian Labs. All rights reserved.
