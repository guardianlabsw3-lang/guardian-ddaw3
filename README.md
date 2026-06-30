# PayOrder W3 Guardian

> **Structured Payment DDA on Web3** — turn digital charges into verifiable Web3 payment
> orders on the **Stellar Testnet**, with an immutable record on a **Soroban** smart contract.

🌐 **Languages / Idiomas:** **[English](#english)** · **[Português](#português)**

This README is a high-level overview. The full Spec-Driven-Design specification lives in
[`docs/specs/payorder-w3-guardian/`](docs/specs/payorder-w3-guardian/README.md) and should
be read in numeric order.

---

# English

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

---

# Português

> **DDA de Pagamento Estruturado em Web3** — transforma cobranças digitais em ordens de
> pagamento Web3 verificáveis na **Stellar Testnet**, com registro imutável em um contrato
> inteligente **Soroban**.

🌐 **Idiomas / Languages:** **[English](#english)** · **[Português](#português)**

Este README é uma visão geral. A especificação completa (Spec Driven Design) está em
[`docs/specs/payorder-w3-guardian/`](docs/specs/payorder-w3-guardian/README.md) e deve ser
lida na ordem numérica.

## 1. O que é o PayOrder W3 Guardian?

O **PayOrder W3 Guardian** é um **rail de cobrança Web3** da **Guardian Labs**. Ele recebe
cobranças de **múltiplas origens** (painel administrativo, API interna, ERP, integrações
futuras) e as converte em **ordens de pagamento verificáveis on-chain**, pagas diretamente
entre wallets Stellar.

Seu propósito é **transformar cobranças digitais em ordens de pagamento Web3 verificáveis**,
com:

- destino claro e inequívoco;
- valor confirmado visualmente pelo pagador antes de pagar;
- registro imutável em blockchain;
- execução do pagamento direto da wallet do pagador para a wallet do tenant recebedor
  (**não custodial**).

> **Escopo do MVP:** opera **apenas em Stellar Testnet**. Mainnet é uma evolução futura planejada.

## 2. O problema que resolve

Cobranças digitais tradicionais (links de pagamento, faturas, propostas) sofrem de
**ambiguidade e baixa confiança no destino**:

1. **Destino opaco** — o pagador raramente consegue verificar, de forma confiável, *quem* está
   recebendo e *para qual conta/wallet* o dinheiro vai.
2. **Adulteração de dados** — valor, destinatário ou dados bancários podem ser alterados no
   caminho (phishing, man-in-the-middle, fraude de boleto).
3. **Falta de prova verificável** — não há registro público e imutável de que a cobrança foi
   emitida com determinados parâmetros.
4. **Erro de digitação de destino** — quando a wallet/conta destino é digitada manualmente na
   hora da cobrança, abre-se espaço para erro humano e fraude.

O PayOrder W3 Guardian ataca cada um desses problemas:

- A **wallet destino nunca é digitada na criação da cobrança.** Ela é resolvida
  automaticamente a partir do **tenant previamente cadastrado**, eliminando erro humano e
  troca maliciosa de destino.
- Os dados relevantes da cobrança são **serializados em payload canônico** e têm seu **hash
  SHA-256** registrado no contrato Soroban — qualquer divergência é detectável.
- Antes de pagar, o pagador vê: **quem recebe, qual wallet, qual valor, qual asset, qual
  status e a prova de registro on-chain**.
- O pagamento é **não custodial**: a wallet do pagador assina diretamente no frontend; a seed
  privada do pagador **nunca** passa pelo backend.

## 3. Proposta central e valor

| Público | Valor |
|---------|-------|
| **Recebedor (tenant)** | Receber pagamentos Web3 sem expor manualmente sua wallet em cada cobrança, com destino sempre correto e registro auditável. |
| **Pagador** | Confiança total no destino antes de pagar; experiência de poucos cliques; prova pública on-chain. |
| **Guardian Labs** | Um componente de cobrança reutilizável que pode ser plugado em outros produtos (checkout, links de pagamento, propostas comerciais), sem acoplamento a um produto específico. |

O produto é **agnóstico à origem**: toda cobrança nasce de uma origem (painel, API, ERP,
integrações futuras), mas segue o **mesmo fluxo interno** de tenant → wallet → ordem →
registro on-chain. O campo `metadata.source` identifica a origem para fins de auditoria.

## 4. O que o pagador consegue verificar

Antes de confirmar o pagamento, o pagador pode confirmar visualmente:

- **quem está recebendo** (nome / razão social, documento quando aplicável);
- **qual wallet Stellar Testnet** receberá o pagamento;
- **qual valor** será transferido;
- **qual asset** será usado;
- **qual o status** da ordem (`ACTIVE`, `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`);
- **se a ordem ainda está ativa**;
- **se a cobrança foi registrada corretamente em blockchain** (id da ordem, hash, contract id,
  link para o explorer da Testnet).

## 5. Princípios norteadores

| Princípio | Aplicação no produto |
|-----------|----------------------|
| **Destino confiável** | Wallet destino vem do cadastro do tenant, nunca digitada na cobrança. |
| **Verificabilidade** | Hash canônico registrado on-chain; consulta pública. |
| **Não custódia do pagador** | Seed do pagador jamais toca o backend; assinatura no frontend. |
| **Preservação histórica** | Wallet destino copiada para a Payment Order na criação. |
| **Testnet primeiro** | MVP isolado em Testnet; Mainnet é evolução futura. |
| **Simplicidade do MVP** | Arquitetura preparada para evoluir, mas escopo enxuto. |

## 6. Conceitos-chave (linguagem ubíqua)

| Termo | Significado |
|-------|-------------|
| **Tenant** | Empresa/sistema recebedor com wallet Stellar Testnet vinculada. |
| **Payment Order** | Cobrança que vira ordem de pagamento Web3 verificável. |
| **Receiver Wallet** | Wallet destino, derivada do tenant e **copiada** para a ordem. |
| **Canonical Payload** | Serialização determinística dos dados relevantes da ordem. |
| **Order Hash** | SHA-256 do payload canônico, registrado on-chain. |
| **Public Slug** | Identificador opaco do link público de pagamento. |
| **Asset** | Par `(code, issuer)`; para XLM nativo, `issuer` é nulo. |

### Payload canônico e hash

O payload canônico é uma serialização JSON **determinística** (chaves ordenadas
lexicograficamente, sem espaços, UTF-8) dos campos relevantes para a integridade do pagamento.
O mesmo conteúdo sempre produz o mesmo hash:

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

`canonical_payload_hash = SHA256(canonical_json_bytes)` (hex). Esse hash é registrado on-chain
e exibido na tela pública para verificação. A função de canonicalização vive em
[`packages/shared`](packages/shared) e é usada **identicamente** por API, worker e testes para
evitar divergência.

## 7. Ciclo de vida da Payment Order

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

| De | Para | Gatilho | Autoridade |
|----|------|---------|-----------|
| CREATED | ACTIVE | Registro on-chain confirmado | Sistema |
| ACTIVE | PAID | Pagamento on-chain válido | Pagador (via contrato) |
| ACTIVE | EXPIRED | `due_date` vencida | Worker |
| ACTIVE | CANCELLED | Cancelamento autorizado | Admin |
| ACTIVE | FAILED | Falha irreversível no registro/pagamento | Sistema |

Estados terminais: `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`. `CREATED` é um estado transitório
off-chain enquanto a ordem aguarda o registro on-chain; a tela pública só habilita o pagamento
quando a ordem está `ACTIVE`.

## 8. Arquitetura

O sistema segue **Clean Architecture + Hexagonal (Ports & Adapters) + DDD simples**. O domínio
fica no centro, sem dependências externas; **as setas de dependência apontam para dentro**.

```text
┌───────────────────────────────────────────────────────────┐
│ Interfaces (controllers HTTP, handlers do worker, CLI)     │
│   ┌───────────────────────────────────────────────────┐   │
│   │ Application (casos de uso, ports, DTOs)            │   │
│   │   ┌───────────────────────────────────────────┐   │   │
│   │   │ Domain (entidades, VOs, regras, eventos)  │   │   │
│   │   └───────────────────────────────────────────┘   │   │
│   └───────────────────────────────────────────────────┘   │
│ Infrastructure (adapters: db, stellar, redis, webhooks)    │
└───────────────────────────────────────────────────────────┘
```

### Fluxo on-chain / off-chain

```text
Origem (painel/API/ERP)
   │
   ▼
Backend API ── resolve tenant ── recupera wallet do tenant
   │                                   │
   ▼            ┌──────────────────────┘
Payment Order (PostgreSQL) ──> payload canônico ──> hash SHA-256
   │
   ├──> registra ordem no contrato Soroban (id, hash, tenant, wallet, valor, asset, ACTIVE)
   ▼
Link público de pagamento
   │
   ▼
Pagador (frontend não custodial) ── conecta wallet ── confirma ── assina ── paga
   │
   ▼
Transferência on-chain (wallet pagador → wallet tenant)
   │
   ▼
Contrato marca PAID ──> Worker sincroniza status off-chain ──> webhooks/consultas
```

### Fonte de verdade

- O **contrato Soroban** é a autoridade sobre o status de pagamento on-chain
  (`ACTIVE`/`PAID`/`CANCELLED`/`EXPIRED`/`FAILED`).
- O **PostgreSQL** é a fonte de verdade operacional/off-chain, mantida em sincronia para
  consultas rápidas, listagens e integrações.
- O **Worker** concilia ambos. Em divergência, o on-chain prevalece para o status de pagamento.

## 9. Stack tecnológica

| Componente | Tecnologia | Por quê |
|------------|------------|---------|
| **Backend API** | Node.js + NestJS + TypeScript | Modularidade, DI nativa, fronteiras limpas; compartilha tipos e canonicalização com o frontend. |
| **Frontend Web** | React + Next.js (App Router) + TypeScript | SSR para a página pública, SPA para o painel admin; Stellar Wallets Kit para assinatura não custodial. |
| **Smart Contract** | Soroban (Rust) | Plataforma nativa de smart contracts da Stellar; autoridade on-chain do status de pagamento. |
| **Worker** | Node.js + BullMQ (Redis) | Jobs assíncronos: registro on-chain, sincronização de status, expiração, entrega/retry de webhooks. |
| **Banco** | PostgreSQL 16 | Fonte de verdade off-chain. |
| **Cache/Filas** | Redis 7 | Filas, idempotência, rate limiting, cache. |
| **Compartilhado** | `packages/shared` (TypeScript) | Schemas zod, tipos, canonicalização + hash, usados por API/web/worker/testes. |

Principais bibliotecas backend: `@nestjs/*`, `zod`, `drizzle-orm` (ORM recomendado),
`@stellar/stellar-sdk`, `bullmq`, `pino`. Principais bibliotecas frontend: `next`, `react`,
`@creit.tech/stellar-wallets-kit`, `@stellar/stellar-sdk`, `@tanstack/react-query`, `zod`,
`tailwindcss`.

## 10. Estrutura do repositório

```text
apps/
  api/        Backend NestJS (domain, application, infrastructure, interfaces)
  web/        Frontend Next.js (página pública de pagamento + painel admin)
  worker/     Worker BullMQ (sincronização on-chain, expiração, webhooks)
packages/
  shared/     Tipos compartilhados, schemas zod, canonicalização + hash
contracts/
  payorder/   Smart contract Soroban (Rust)
infra/
  docker/     docker-compose para deploy local + VPS (Traefik)
  traefik/    Notas de integração com Traefik
  scripts/    Scripts de deploy + deploy do contrato
openapi/      payorder-api.yaml — contrato REST
docs/specs/   Especificação completa (Spec Driven Design — ler na ordem numérica)
```

## 11. Como começar (local)

A stack local está a um comando de distância. Stellar/Soroban falam com a Testnet pública via
env, então nenhum container de blockchain é necessário.

```bash
make up        # build e sobe a stack local completa (detached)
make migrate   # aplica as migrations do banco
make seed      # cria um admin + um tenant ativo com wallet
make logs      # acompanha os logs
make down      # para a stack (mantém os dados)
```

Rode `make help` para listar todos os targets. Veja
[`docs/specs/payorder-w3-guardian/12-docker-local.md`](docs/specs/payorder-w3-guardian/12-docker-local.md)
para detalhes e [`13-docker-vps-traefik.md`](docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md)
para o deploy seguro em VPS atrás de um Traefik existente.

## 12. Invariantes do produto (sempre verdadeiras)

1. O MVP opera **apenas em Stellar Testnet**.
2. A **wallet destino nunca é digitada** na criação da cobrança — é resolvida do tenant.
3. A wallet principal do tenant fica **na tabela `tenants`** (sem `tenant_wallets` no MVP).
4. A wallet destino é **copiada para a Payment Order** na criação (histórico preservado).
5. O sistema **nunca** armazena a seed privada da wallet do **pagador**.
6. **Boleto Guardian** não é considerado; **ERP é apenas um exemplo** de origem.

## 13. Roadmap (resumo)

- **Fase 0 — Fundações:** SPEC, monorepo e tooling, `packages/shared` (tipos, schemas, canonicalização + hash).
- **Fase 1 — Contrato Soroban:** `register_order`, `pay`, `get_order`, `cancel`, `expire`; testes ≥ 85%; deploy na Testnet.
- **Fase 2 — Núcleo do backend:** domínio + persistência + casos de uso (onboarding, wallet, criação de ordem multi-origem).
- **Fase 3 — Integração on-chain:** adapter Soroban, worker de registro assíncrono, worker de sincronização/expiração, consulta pública.
- **Fase 4 — APIs e segurança:** endpoints admin e de integração, auth (JWT + API keys), idempotência, rate limiting, webhooks assinados, OpenAPI.
- **Fase 5 — Frontend:** página pública de pagamento não custodial, painel admin, E2E com Playwright.
- **Fase 6 — Empacotamento e deploy:** Docker local + VPS (Traefik), observabilidade.
- **Fase 7 — Hardening e evolução (pós-MVP):** Mainnet, multi-asset/issuer, múltiplos usuários por tenant, custódia gerenciada (Vault/KMS/HSM).

Roadmap completo em
[`docs/specs/payorder-w3-guardian/17-roadmap.md`](docs/specs/payorder-w3-guardian/17-roadmap.md).

## 14. Mapa da documentação

| # | Documento | Conteúdo |
|---|-----------|----------|
| 00 | [Propósito](docs/specs/payorder-w3-guardian/00-purpose.md) | Propósito e problema que resolve. |
| 01 | [Visão de produto](docs/specs/payorder-w3-guardian/01-product-vision.md) | Visão de negócio e técnica. |
| 02 | [Requisitos](docs/specs/payorder-w3-guardian/02-requirements.md) | Escopo MVP, fora de escopo, personas, casos de uso, RF/RNF, regras. |
| 03 | [Modelo de domínio](docs/specs/payorder-w3-guardian/03-domain-model.md) | Agregados, VOs, estados, payload canônico/hash, eventos, ports. |
| 04 | [Arquitetura](docs/specs/payorder-w3-guardian/04-architecture.md) | Clean/Hexagonal, stack, módulos, ADRs. |
| 05 | [Onboarding de tenant](docs/specs/payorder-w3-guardian/05-tenant-onboarding.md) | Campos, fluxo, validações. |
| 06 | [Wallet do tenant](docs/specs/payorder-w3-guardian/06-wallet-management.md) | Opções A/B, recomendação, regras de alteração. |
| 07 | [Contrato Soroban](docs/specs/payorder-w3-guardian/07-smart-contract.md) | Estruturas, métodos, estados, erros, testes. |
| 08 | [APIs REST](docs/specs/payorder-w3-guardian/08-api-contracts.md) | Endpoints, auth, idempotência, webhooks. |
| 09 | [Modelo de dados](docs/specs/payorder-w3-guardian/09-data-model.md) | Tabelas PostgreSQL, índices, constraints. |
| 10 | [Segurança](docs/specs/payorder-w3-guardian/10-security.md) | Controles e checklist. |
| 11 | [Testes](docs/specs/payorder-w3-guardian/11-testing-strategy.md) | Níveis, cobertura, E2E, erros. |
| 12 | [Docker local](docs/specs/payorder-w3-guardian/12-docker-local.md) | Compose local, env, comandos. |
| 13 | [Docker VPS/Traefik](docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md) | Deploy seguro com Traefik existente. |
| 14 | [Deploy](docs/specs/payorder-w3-guardian/14-deployment.md) | Ambientes, CI/CD, contrato, migrations, rollback. |
| 15 | [Observabilidade](docs/specs/payorder-w3-guardian/15-observability.md) | Logs, correlação, métricas, health/ready. |
| 16 | [Integrações](docs/specs/payorder-w3-guardian/16-integrations.md) | Frontend público, painel, manual, API, ERP. |
| 17 | [Roadmap](docs/specs/payorder-w3-guardian/17-roadmap.md) | Roadmap técnico por fases. |
| 18 | [Backlog de implementação](docs/specs/payorder-w3-guardian/18-implementation-tasks.md) | TASK-001..030 implementáveis. |

## 15. Licença

`UNLICENSED` — © Guardian Labs. Todos os direitos reservados.
