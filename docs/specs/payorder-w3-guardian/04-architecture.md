# 04 — Arquitetura

## 1. Estilo arquitetural

Combinação de **Clean Architecture** + **Hexagonal (Ports & Adapters)** + **DDD simples**:

- **Domínio** no centro (entidades, VOs, regras, eventos) — sem dependências externas.
- **Aplicação** (casos de uso) orquestra o domínio e depende apenas de **ports**.
- **Infraestrutura** implementa os ports (PostgreSQL, Stellar/Soroban, Redis, webhooks).
- **Interfaces** (HTTP/REST, jobs do worker) traduzem entrada/saída para casos de uso.

Regra de dependência: **as setas apontam para dentro**. Domínio não conhece aplicação;
aplicação não conhece infraestrutura/interfaces.

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
        Infra e Interfaces dependem de Application/Domain
```

## 2. Escolha de stack (com justificativa)

### 2.1 Backend — **Node.js + NestJS + TypeScript** ✅

Justificativa:
- **NestJS** favorece modularidade, DI nativa e fronteiras limpas — encaixa em Clean/Hexagonal.
- **TypeScript** compartilha **tipos e canonicalização** com o frontend e `packages/shared`,
  reduzindo divergência do payload/hash entre serviços.
- Ecossistema Stellar maduro em JS (`@stellar/stellar-sdk`) cobre Horizon, RPC Soroban e
  transações.
- Mesma linguagem em API/worker/web acelera o MVP e reduz custo cognitivo.

Alternativas consideradas: **FastAPI (Python)** — excelente para DX e validação, mas perde
o compartilhamento de tipos com o front; **Spring Boot (Java)** — robusto, porém mais
verboso e pesado para o MVP. NestJS oferece o melhor equilíbrio para este produto.

Bibliotecas backend principais: `@nestjs/*`, `zod` (validação/contratos), `drizzle-orm` ou
`prisma` (ORM/migrations — recomendado **Drizzle** por SQL explícito e leveza),
`@stellar/stellar-sdk`, `bullmq` (filas no Redis), `pino` (logs estruturados).

### 2.2 Frontend — **React + Next.js (App Router) + TypeScript** ✅

Justificativa:
- **Next.js** entrega SSR para a **página pública** (SEO/preview de link, primeira pintura
  rápida) e SPA para o **painel admin**.
- Reuso de tipos/zod schemas de `packages/shared`.
- Integração de wallet via **Stellar Wallets Kit** (Freighter, Albedo, etc.) no cliente,
  mantendo o modelo **não custodial**.
- Componentização e DX maduras (App Router, Server Components onde fizer sentido).

Alternativa: **Angular** — sólido, mas o ecossistema de wallets Stellar e o
compartilhamento de tipos é mais natural no stack React/Next.

Bibliotecas frontend principais: `next`, `react`, `@creit.tech/stellar-wallets-kit`,
`@stellar/stellar-sdk`, `@tanstack/react-query`, `zod`, `tailwindcss`.

### 2.3 Contrato — **Soroban (Rust)** ✅

Padrão da plataforma Stellar para smart contracts. SDK `soroban-sdk`, testes com o test
harness nativo. Ver `07-smart-contract.md`.

### 2.4 Worker — **Node.js + BullMQ (Redis)** ✅

Mesma base do backend; processa filas de sincronização on-chain, expiração e webhooks.

### 2.5 Banco — **PostgreSQL 16** ✅; **Redis 7** (filas/idempotência/rate limit/cache).

## 3. Estrutura interna do backend (`apps/api`)

```text
apps/api/src/
  domain/
    tenant/            (Tenant, VOs, eventos, regras)
    payment-order/     (PaymentOrder, máquina de estados, eventos)
    shared/            (VOs comuns: Money, Asset, StellarPublicKey...)
  application/
    ports/             (interfaces: repos, StellarLedgerPort, SorobanContractPort, ...)
    tenant/            (use cases: CreateTenant, AssignWallet, ...)
    payment-order/     (use cases: CreatePaymentOrder, GetPublicOrder, CancelOrder, ...)
    dto/               (input/output DTOs)
  infrastructure/
    persistence/       (Drizzle repos, schema, migrations, mappers)
    stellar/           (HorizonAdapter, SorobanRpcAdapter, SorobanContractAdapter)
    webhooks/          (dispatcher, signer, retry)
    queue/             (BullMQ producers)
    config/            (env loading + validation via zod)
    observability/     (pino logger, correlation-id, metrics)
  interfaces/
    http/              (controllers, guards, pipes, exception filters, openapi)
    health/            (/health, /ready)
  main.ts
```

A camada `domain` e a maior parte de `application` são **independentes de NestJS** (POJOs +
interfaces). NestJS aparece em `interfaces` e na fiação de DI em `infrastructure`.

## 4. Módulos do sistema (visão macro)

| Módulo | Responsabilidade |
|--------|------------------|
| **Tenant Module** | CRUD de tenant, onboarding, gestão de wallet no cadastro. |
| **Payment Order Module** | Criação multi-origem, payload canônico, hash, ciclo de vida. |
| **Stellar/Soroban Module** | Adapters para Horizon, Soroban RPC e o contrato PayOrder. |
| **Public Module** | Consulta pública por slug; dados para a tela de pagamento. |
| **Webhook Module** | Assinatura, entrega, retries e reenvio de webhooks. |
| **Auth Module** | Autenticação admin (sessão/JWT) e API keys de integradores. |
| **Audit Module** | Trilha de auditoria de eventos críticos. |
| **Sync/Worker Module** | Conciliação on-chain/off-chain, expiração, processamento de filas. |
| **Observability Module** | Logs estruturados, correlation id, métricas, health/ready. |

## 5. Comunicação entre componentes (contratos)

- **Frontend ↔ API**: REST descrito em `openapi/payorder-api.yaml`; validação com zod.
- **API ↔ Contrato**: `SorobanContractPort` (interface estável) → `SorobanContractAdapter`
  (usa `@stellar/stellar-sdk` + Soroban RPC). A interface do contrato (métodos/eventos)
  está em `07-smart-contract.md`.
- **API ↔ Worker**: filas BullMQ (Redis) com jobs tipados; payloads validados por zod.
- **API → Integradores**: webhooks assinados (HMAC) descritos em `08-api-contracts.md`.
- **Tipos compartilhados**: `packages/shared` exporta schemas zod, tipos, canonicalização e
  cálculo de hash — usados por api, web, worker e testes.

## 6. Decisões arquiteturais (ADR resumidos)

| ADR | Decisão | Motivo |
|-----|---------|--------|
| ADR-01 | Monorepo TS + contrato Rust | Compartilhar tipos/canonicalização; isolar contrato. |
| ADR-02 | NestJS no backend | Modularidade + DI alinhadas a Clean/Hexagonal. |
| ADR-03 | Next.js no frontend | SSR público + painel SPA + wallets Stellar no cliente. |
| ADR-04 | Wallet do tenant **na tabela `tenants`** | Requisito do MVP; simplicidade. |
| ADR-05 | Cópia da wallet para a ordem | Preservar histórico mesmo após troca da wallet. |
| ADR-06 | Registro on-chain **assíncrono** via worker | Resiliência; resposta rápida da API. |
| ADR-07 | Redis para idempotência/filas/rate limit | Resiliência e proteção contra replay. |
| ADR-08 | On-chain como autoridade de status de pagamento | Verificabilidade; off-chain concilia. |

## 7. Estratégia de registro on-chain (síncrono vs assíncrono)

Recomendação MVP: **híbrido**.
1. A API cria a ordem off-chain (`CREATED`) e responde imediatamente com o link público
   (estado "registrando").
2. Um job de worker registra a ordem no contrato Soroban; ao confirmar, transita para
   `ACTIVE` e grava `soroban_contract_id`/`tx_hash`.
3. A tela pública só habilita o pagamento quando `ACTIVE`.

Isso evita travar a requisição HTTP no tempo de confirmação da rede e dá pontos naturais de
retry/idempotência. Para ambientes de teste pode-se habilitar modo síncrono via flag.
