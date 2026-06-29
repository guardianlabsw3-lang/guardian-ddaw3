# SPEC — PayOrder W3 Guardian

Especificação completa (Spec Driven Design) do produto **PayOrder W3 Guardian** da Guardian
Labs. Leitura na ordem numérica. MVP em **Stellar Testnet**.

| # | Documento | Conteúdo |
|---|-----------|----------|
| 00 | [Propósito](00-purpose.md) | Propósito e problema que resolve. |
| 01 | [Visão de produto](01-product-vision.md) | Visão de negócio e técnica. |
| 02 | [Requisitos](02-requirements.md) | Escopo MVP, fora de escopo, personas, casos de uso, RF/RNF, regras. |
| 03 | [Modelo de domínio](03-domain-model.md) | Agregados, VOs, estados, payload canônico/hash, eventos, ports. |
| 04 | [Arquitetura](04-architecture.md) | Clean/Hexagonal, stack, módulos, ADRs. |
| 05 | [Onboarding de tenant](05-tenant-onboarding.md) | Campos, fluxo, validações. |
| 06 | [Wallet do tenant](06-wallet-management.md) | Opções A/B, recomendação, regras de alteração. |
| 07 | [Contrato Soroban](07-smart-contract.md) | Estruturas, métodos, estados, erros, testes. |
| 08 | [APIs REST](08-api-contracts.md) | Endpoints, auth, idempotência, webhooks. |
| 09 | [Modelo de dados](09-data-model.md) | Tabelas PostgreSQL, índices, constraints. |
| 10 | [Segurança](10-security.md) | Controles e checklist. |
| 11 | [Testes](11-testing-strategy.md) | Níveis, cobertura, E2E, erros. |
| 12 | [Docker local](12-docker-local.md) | Compose local, env, comandos. |
| 13 | [Docker VPS/Traefik](13-docker-vps-traefik.md) | Deploy seguro com Traefik existente. |
| 14 | [Deploy](14-deployment.md) | Ambientes, CI/CD, contrato, migrations, rollback. |
| 15 | [Observabilidade](15-observability.md) | Logs, correlação, métricas, health/ready. |
| 16 | [Integrações](16-integrations.md) | Frontend público, painel, manual, API, ERP. |
| 17 | [Roadmap](17-roadmap.md) | Roadmap técnico por fases. |
| 18 | [Implementation Backlog](18-implementation-tasks.md) | TASK-001..030 implementáveis. |

Artefatos complementares: [`openapi/payorder-api.yaml`](../../../openapi/payorder-api.yaml),
[`contracts/payorder/README.md`](../../../contracts/payorder/README.md),
[`infra/docker/README.md`](../../../infra/docker/README.md).

## Invariantes do produto (sempre verdadeiras)

1. MVP opera **apenas em Stellar Testnet**.
2. A **wallet destino nunca é digitada** na criação da cobrança — é resolvida do tenant.
3. A wallet principal do tenant fica **na tabela `tenants`** (sem `tenant_wallets` no MVP).
4. A wallet destino é **copiada para a Payment Order** na criação (histórico preservado).
5. O sistema **nunca** armazena a seed privada da wallet do **pagador**.
6. **Boleto Guardian** não é considerado; **ERP é apenas um exemplo** de origem.
