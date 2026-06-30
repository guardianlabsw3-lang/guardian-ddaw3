# PayOrder W3 Guardian

> **DDA de Pagamento Estruturado em Web3** — transforma cobranças digitais em ordens de
> pagamento Web3 verificáveis na **Stellar Testnet**, com registro imutável em um contrato
> inteligente **Soroban**.

🌐 **Idiomas / Languages:** **Português (este documento)** · **[English](README.en.md)**

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
