# 18 — Implementation Backlog

Tarefas pequenas, ordenadas e implementáveis. Cada tarefa traz **objetivo**, **arquivos
afetados**, **critérios de aceite**, **testes esperados**, **dependências** e **risco
técnico**. Esta é a fonte de verdade para a execução incremental **após** a aprovação da SPEC.

Legenda de risco: 🟢 baixo · 🟡 médio · 🔴 alto.

---

### TASK-001 — Criar estrutura base do repositório
- **Objetivo:** Monorepo com `apps/{api,web,worker}`, `contracts/payorder`, `packages/shared`, `infra/{docker,traefik}`, `docs`, `openapi`; tooling (workspace, lint, format, tsconfig base, CI inicial).
- **Arquivos:** raiz (`package.json`/workspaces, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.github/workflows/ci.yml`), diretórios placeholders.
- **Critérios de aceite:** `install`, `lint` e `typecheck` rodam na raiz; CI executa lint/typecheck.
- **Testes esperados:** smoke de CI (lint/typecheck verdes).
- **Dependências:** —
- **Risco:** 🟢

### TASK-002 — Criar documentação inicial do domínio
- **Objetivo:** Consolidar glossário, agregados e máquina de estados como referência viva.
- **Arquivos:** `docs/specs/payorder-w3-guardian/03-domain-model.md` (já existe), `packages/shared/README.md`.
- **Critérios de aceite:** Glossário e estados documentados e linkados no README.
- **Testes esperados:** N/A (doc).
- **Dependências:** TASK-001
- **Risco:** 🟢

### TASK-003 — Spec de onboarding de tenant (revisão executável)
- **Objetivo:** Detalhar campos/validações/erros de onboarding como contrato para implementação.
- **Arquivos:** `docs/specs/.../05-tenant-onboarding.md` (existe), schemas em `packages/shared`.
- **Critérios de aceite:** Schemas zod de Tenant definidos e exportados.
- **Testes esperados:** Testes de schema (válido/ inválido).
- **Dependências:** TASK-001
- **Risco:** 🟢

### TASK-004 — Spec/implementação da wallet no cadastro do tenant
- **Objetivo:** VO `StellarPublicKey`/`StellarAccount`, validação strkey, rede Testnet.
- **Arquivos:** `packages/shared/src/stellar/*`, `apps/api/src/domain/shared/*`.
- **Critérios de aceite:** Valida public key (prefixo G, 56 chars, checksum) e rede TESTNET.
- **Testes esperados:** Unidade: chaves válidas/ inválidas, rede inválida.
- **Dependências:** TASK-002
- **Risco:** 🟢

### TASK-005 — Canonicalização + hash SHA-256 (shared)
- **Objetivo:** Função determinística de payload canônico e cálculo de hash, única para api/worker/web.
- **Arquivos:** `packages/shared/src/canonical/*`.
- **Critérios de aceite:** Saída determinística (chaves ordenadas, `amount` escala 7, issuer nulo → `""`); hash hex 64.
- **Testes esperados:** Unidade: determinismo, casos de borda.
- **Dependências:** TASK-002
- **Risco:** 🟡 (divergência de hash entre serviços se duplicado)

### TASK-006 — Contrato Soroban mínimo
- **Objetivo:** `initialize`, `register_order`, `get_order`, estruturas e erros.
- **Arquivos:** `contracts/payorder/src/lib.rs`, `Cargo.toml`.
- **Critérios de aceite:** Registra ordem `ACTIVE`; impede duplicidade; consulta funciona.
- **Testes esperados:** Unidade do contrato (registro/duplicado/consulta).
- **Dependências:** TASK-001
- **Risco:** 🟡

### TASK-007 — Contrato: pagamento e ciclo de vida
- **Objetivo:** `pay`, `cancel_order`, `expire_order`, `mark_failed`, eventos.
- **Arquivos:** `contracts/payorder/src/lib.rs`.
- **Critérios de aceite:** Paga só `ACTIVE`; valida valor/asset/vencimento; marca `PAID`; impede duplo pagamento; autorização correta; emite eventos.
- **Testes esperados:** Unidade: todos os casos de `07 §8`.
- **Dependências:** TASK-006
- **Risco:** 🔴 (regras financeiras on-chain)

### TASK-008 — Testes unitários do contrato (cobertura)
- **Objetivo:** Cobrir ≥ 85% dos métodos públicos e casos de erro.
- **Arquivos:** `contracts/payorder/src/test.rs`.
- **Critérios de aceite:** `cargo test` verde; cobertura ≥ 85%.
- **Testes esperados:** Conforme `07 §8`.
- **Dependências:** TASK-007
- **Risco:** 🟡

### TASK-009 — Deploy do contrato na Testnet + script
- **Objetivo:** Build WASM, deploy, `initialize`, registrar `CONTRACT_ID`.
- **Arquivos:** `contracts/payorder/README.md`, `infra/scripts/deploy-contract.sh`.
- **Critérios de aceite:** Contrato deployado; `CONTRACT_ID` documentado; `initialize` ok.
- **Testes esperados:** Smoke: `get_order` em ordem registrada manualmente.
- **Dependências:** TASK-008
- **Risco:** 🟡 (dependência de rede)

### TASK-010 — Domínio Tenant + PaymentOrder (api)
- **Objetivo:** Entidades, VOs, máquina de estados, eventos de domínio (puro).
- **Arquivos:** `apps/api/src/domain/{tenant,payment-order,shared}/*`.
- **Critérios de aceite:** Invariantes/transições aplicadas; `PaymentOrder.create` fixa wallet copiada e hash.
- **Testes esperados:** Unidade ≥ 90% do domínio.
- **Dependências:** TASK-004, TASK-005
- **Risco:** 🟡

### TASK-011 — Configuração e validação de ambiente
- **Objetivo:** Carregamento/validação de env (zod); forçar `TESTNET`.
- **Arquivos:** `apps/api/src/infrastructure/config/*`, `*.env.example`.
- **Critérios de aceite:** App não sobe com env inválida; Mainnet rejeitada.
- **Testes esperados:** Unidade de config.
- **Dependências:** TASK-001
- **Risco:** 🟢

### TASK-012 — Persistência PostgreSQL (schema + migrations)
- **Objetivo:** Tabelas de `09-data-model.md` com índices/constraints.
- **Arquivos:** `apps/api/src/infrastructure/persistence/{schema,migrations}/*`.
- **Critérios de aceite:** Migrations aplicam limpo; constraints e índices presentes.
- **Testes esperados:** Integração: migrate up/down; unicidade `(tenant_id, external_id)`.
- **Dependências:** TASK-001
- **Risco:** 🟡

### TASK-013 — Repositórios (Tenant, PaymentOrder, eventos)
- **Objetivo:** Implementar ports de repositório com Drizzle + mappers.
- **Arquivos:** `apps/api/src/infrastructure/persistence/*`, ports em `application/ports`.
- **Critérios de aceite:** CRUD e queries (por slug/document/external_id) funcionam.
- **Testes esperados:** Integração com Testcontainers.
- **Dependências:** TASK-010, TASK-012
- **Risco:** 🟡

### TASK-014 — Use cases de Tenant (criar/consultar/ativar/wallet)
- **Objetivo:** Onboarding, ativar/inativar, cadastrar/atualizar/consultar wallet.
- **Arquivos:** `apps/api/src/application/tenant/*`.
- **Critérios de aceite:** Regras de `05`/`06`; bloqueio de troca de wallet com ordens ativas.
- **Testes esperados:** Unidade + integração (bloqueio de wallet).
- **Dependências:** TASK-013
- **Risco:** 🟡

### TASK-015 — Use case CreatePaymentOrder (multi-origem)
- **Objetivo:** Resolver tenant (id/slug/document), validar ativo+wallet, copiar wallet, canonical+hash, persistir `CREATED`, gerar slug, enfileirar registro on-chain.
- **Arquivos:** `apps/api/src/application/payment-order/*`, `infrastructure/queue/*`.
- **Critérios de aceite:** RN-01..RN-04 aplicadas; wallet manual rejeitada; idempotência por `(tenant_id, external_id)`.
- **Testes esperados:** Unidade + integração (todos os erros de `02 §7`).
- **Dependências:** TASK-005, TASK-013, TASK-014
- **Risco:** 🔴 (núcleo do produto)

### TASK-016 — SorobanContractAdapter + worker de registro
- **Objetivo:** `register_order`/`get_order` via Soroban RPC; job `CREATED→ACTIVE`.
- **Arquivos:** `apps/api/src/infrastructure/stellar/*`, `apps/worker/src/jobs/register-order.ts`.
- **Critérios de aceite:** Ordem registrada on-chain; status atualizado; idempotente; retries.
- **Testes esperados:** Integração Testnet (flag) + unidade com adapter mockado.
- **Dependências:** TASK-009, TASK-015
- **Risco:** 🔴

### TASK-017 — Worker de sincronização e expiração
- **Objetivo:** Conciliar on-chain/off-chain (paid/cancelled/expired) e expirar vencidas.
- **Arquivos:** `apps/worker/src/jobs/{sync-status,expire-orders}.ts`.
- **Critérios de aceite:** `PAID`/`EXPIRED` refletidos off-chain; divergências logadas.
- **Testes esperados:** Integração (mock RPC) + `Clock` injetável para expiração.
- **Dependências:** TASK-016
- **Risco:** 🟡

### TASK-018 — API: endpoints de Tenants
- **Objetivo:** CRUD/ativação/wallet de tenant (controllers + DTOs + validação).
- **Arquivos:** `apps/api/src/interfaces/http/tenant/*`.
- **Critérios de aceite:** Conforme `08`; erros padronizados.
- **Testes esperados:** Contrato de API + integração.
- **Dependências:** TASK-014
- **Risco:** 🟢

### TASK-019 — API: endpoints de Payment Orders + consulta pública
- **Objetivo:** Criar/listar/consultar/status/eventos/cancelar + `GET /api/public/...`.
- **Arquivos:** `apps/api/src/interfaces/http/payment-order/*`, `.../public/*`.
- **Critérios de aceite:** Conforme `08`; consulta pública sem dados sensíveis.
- **Testes esperados:** Contrato de API + integração (incl. wallet manual rejeitada).
- **Dependências:** TASK-015, TASK-016
- **Risco:** 🟡

### TASK-020 — Auth admin (JWT) e API keys
- **Objetivo:** Login admin (argon2id), guard JWT; API keys com escopos/tenants.
- **Arquivos:** `apps/api/src/interfaces/http/auth/*`, `infrastructure/auth/*`.
- **Critérios de aceite:** Endpoints protegidos; escopos aplicados; `401/403` corretos.
- **Testes esperados:** Integração de auth.
- **Dependências:** TASK-012
- **Risco:** 🟡

### TASK-021 — Idempotência, rate limiting e CORS
- **Objetivo:** `Idempotency-Key` (Redis+DB), rate limit por key/IP, CORS allowlist.
- **Arquivos:** `apps/api/src/interfaces/http/middleware/*`, `infrastructure/idempotency/*`.
- **Critérios de aceite:** Reenvio idêntico retorna mesma resposta; `429` com `Retry-After`.
- **Testes esperados:** Integração de idempotência/rate limit.
- **Dependências:** TASK-019
- **Risco:** 🟡

### TASK-022 — Webhooks (assinatura, entrega, retries, reenvio)
- **Objetivo:** Dispatcher HMAC + backoff + `webhook_deliveries` + reenvio manual.
- **Arquivos:** `apps/api/src/infrastructure/webhooks/*`, `apps/worker/src/jobs/deliver-webhook.ts`.
- **Critérios de aceite:** Assinatura válida; retries persistidos; reenvio via endpoint.
- **Testes esperados:** Integração (servidor mock recebendo webhook + verificação HMAC).
- **Dependências:** TASK-017
- **Risco:** 🟡

### TASK-023 — Auditoria e observabilidade
- **Objetivo:** `audit_logs`, logs estruturados com `correlation_id`, `/health`, `/ready`, métricas básicas.
- **Arquivos:** `apps/api/src/infrastructure/observability/*`, `interfaces/health/*`, `audit/*`.
- **Critérios de aceite:** Correlação ponta a ponta; `/ready` checa DB/Redis/RPC; auditoria de ações críticas.
- **Testes esperados:** Integração de health/ready; verificação de campos de log.
- **Dependências:** TASK-019
- **Risco:** 🟢

### TASK-024 — OpenAPI completo + testes de contrato
- **Objetivo:** `openapi/payorder-api.yaml` cobrindo todos os endpoints; validação no CI.
- **Arquivos:** `openapi/payorder-api.yaml`, testes de contrato.
- **Critérios de aceite:** Spec válido; backend conforme; CI valida.
- **Testes esperados:** Contrato de API (Dredd/schemathesis).
- **Dependências:** TASK-019, TASK-020
- **Risco:** 🟢

### TASK-025 — Frontend: tela pública de pagamento (não custodial)
- **Objetivo:** Página por slug; conectar wallet; confirmar; `pay`; status + explorer; aviso Testnet.
- **Arquivos:** `apps/web/app/p/[slug]/*`, `apps/web/src/stellar/*`.
- **Critérios de aceite:** Fluxo de poucos cliques; seed nunca no backend; exibe destino/valor/hash.
- **Testes esperados:** E2E (Playwright) + unidade de componentes.
- **Dependências:** TASK-019
- **Risco:** 🔴 (integração de wallet/assinatura)

### TASK-026 — Frontend: painel admin
- **Objetivo:** Listar tenants, cadastrar/editar wallet, criar cobrança manual (wallet read-only), listar cobranças, status, eventos.
- **Arquivos:** `apps/web/app/admin/*`.
- **Critérios de aceite:** Criação manual sem digitar wallet; wallet carregada do tenant.
- **Testes esperados:** E2E do painel.
- **Dependências:** TASK-018, TASK-019, TASK-020
- **Risco:** 🟡

### TASK-027 — Docker Compose local + Makefile + seeds
- **Objetivo:** `docker-compose.local.yml`, `.env.local.example`, Makefile, seed de exemplo.
- **Arquivos:** `infra/docker/*`, `Makefile`.
- **Critérios de aceite:** `make up` sobe tudo; migrations e seed rodam; front/API acessíveis.
- **Testes esperados:** Smoke local (criar tenant+wallet+ordem só com tenant+valor).
- **Dependências:** TASK-019, TASK-025, TASK-026
- **Risco:** 🟡

### TASK-028 — Docker Compose VPS com Traefik
- **Objetivo:** `docker-compose.vps.yml` com rede externa, labels, sem portas, isolamento.
- **Arquivos:** `infra/docker/docker-compose.vps.yml`, `.env.vps.example`, `infra/traefik/README.md`.
- **Critérios de aceite:** `config` válido; não colide com produto existente; TLS via Traefik.
- **Testes esperados:** Dry-run `config`; checklist de `13 §5`.
- **Dependências:** TASK-027
- **Risco:** 🟡

### TASK-029 — CI/CD e deploy
- **Objetivo:** Pipeline (lint→testes→build→push→deploy) + smoke pós-deploy.
- **Arquivos:** `.github/workflows/*`, `infra/scripts/deploy.sh`.
- **Critérios de aceite:** PR roda testes; release builda/empurra imagens; deploy aplica migrations.
- **Testes esperados:** Pipeline verde; smoke `/health`,`/ready`.
- **Dependências:** TASK-024, TASK-028
- **Risco:** 🟡

### TASK-030 — E2E completo + testes de erro
- **Objetivo:** Cobrir os 9 passos do fluxo E2E e os testes de erro de `11 §8/§9`.
- **Arquivos:** `apps/web/e2e/*`, `apps/api/test/e2e/*`.
- **Critérios de aceite:** Fluxo completo verde; duplo pagamento impedido; erros cobertos.
- **Testes esperados:** E2E + integração de erros.
- **Dependências:** TASK-025, TASK-026, TASK-016, TASK-017
- **Risco:** 🔴

---

## Ordem recomendada de execução

`001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 →
015 → 016 → 017 → 018 → 019 → 020 → 021 → 022 → 023 → 024 → 025 → 026 → 027 → 028 →
029 → 030`

Marcos de valor:
- **M1 (TASK-009):** contrato vivo na Testnet.
- **M2 (TASK-019):** API cria ordem só com tenant+valor e registra on-chain.
- **M3 (TASK-025/026):** fluxo de pagamento ponta a ponta.
- **M4 (TASK-028/029):** deploy seguro na VPS com Traefik.
- **M5 (TASK-030):** E2E completo e testes de erro verdes.
