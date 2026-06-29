# 17 — Roadmap Técnico

## Fase 0 — Fundações (SPEC + scaffolding)
- SPEC (este conjunto de documentos). ✅
- Estrutura de monorepo, tooling (lint, format, typecheck, CI base).
- `packages/shared`: tipos, schemas zod, canonicalização + hash.

## Fase 1 — Contrato Soroban (Testnet)
- Implementar contrato PayOrder (`register_order`, `pay`, `get_order`, `cancel`, `expire`).
- Testes unitários do contrato (≥ 85%).
- Deploy na Testnet + `initialize`.

## Fase 2 — Backend núcleo
- Domínio (`Tenant`, `PaymentOrder`, VOs, máquina de estados) + testes.
- Persistência PostgreSQL (migrations, repos) + testes de integração.
- Use cases: onboarding de tenant, gestão de wallet, criação de ordem (multi-origem).
- Resolução automática da wallet + cópia para a ordem + payload canônico/hash.

## Fase 3 — Integração on-chain
- `SorobanContractAdapter` (register/get) + worker de registro assíncrono (`CREATED→ACTIVE`).
- Worker de sincronização on-chain/off-chain e de expiração.
- Consulta pública por slug.

## Fase 4 — APIs e segurança
- Endpoints admin e de integração; auth admin (JWT) e API keys.
- Idempotência, rate limiting, CORS, validação, auditoria.
- Webhooks assinados + retries + reenvio.
- OpenAPI completo + testes de contrato de API.

## Fase 5 — Frontend
- Tela pública de pagamento não custodial (conectar wallet, confirmar, pagar).
- Painel admin (tenants, wallet, criação manual, listagem, status, eventos).
- Testes E2E (Playwright) do fluxo completo.

## Fase 6 — Empacotamento e deploy
- Docker local (compose) + Makefile + seeds.
- Docker VPS com Traefik existente; deploy seguro; backups.
- Observabilidade (health/ready, logs estruturados, métricas básicas).

## Fase 7 — Hardening e evolução (pós-MVP)
- Prova de posse da wallet do tenant (obrigatória).
- Métricas/alertas/painéis.
- Preparação para **Mainnet**, **múltiplos assets/issuers**, **múltiplos usuários por
  tenant** e novas origens (checkout, links, propostas).
- Custódia gerenciada (Vault/KMS/HSM) caso o produto venha a criar wallets.

## Evoluções futuras explícitas
- Mainnet (com gestão de risco e custódia adequada).
- Multi-asset e multi-issuer por tenant.
- Tabela `tenant_wallets` (histórico/múltiplas wallets) sem quebrar contratos.
- RBAC granular; portal do tenant self-service.
- Reconciliação financeira, relatórios e fees.
