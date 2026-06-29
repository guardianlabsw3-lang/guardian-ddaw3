# 14 — Estratégia de Deploy

## 1. Ambientes

| Ambiente | Rede Stellar | Infra | Propósito |
|----------|--------------|-------|-----------|
| Local | Testnet | Docker Compose local | Desenvolvimento. |
| CI | Testnet (mock/flag) | Runners + Testcontainers | Testes automatizados. |
| VPS (staging/prod-testnet) | Testnet | Docker Compose + Traefik existente | Homologação/uso em Testnet. |

> O MVP **não** possui ambiente Mainnet. "Produção" aqui é uma instância estável em Testnet.

## 2. Artefatos

- **Imagens Docker:** `payorder-api` (serve API e worker via comando) e `payorder-web`.
  Tag por `IMAGE_TAG` (ex.: SHA do commit ou versão semver).
- **Contrato Soroban:** WASM compilado + `SOROBAN_CONTRACT_ID` resultante do deploy na
  Testnet (artefato versionado/documentado).
- **OpenAPI:** publicado junto à API (`/docs`) e versionado.

## 3. Pipeline CI/CD (sugerido)

```text
1. Lint + typecheck (api, web, shared)
2. Testes unitários (domínio) + integração (Testcontainers)
3. Testes do contrato (cargo test)
4. Testes de contrato de API (OpenAPI)
5. Build de imagens (api, web) + push para registry
6. (Opcional/noturno) Testes Stellar Testnet + E2E Playwright
7. Deploy:
     - Aplicar migrations (serviço migrate)
     - Subir/atualizar serviços via docker compose -p payorder -f docker-compose.vps.yml
8. Smoke test pós-deploy (/health, /ready, criação de ordem de teste)
```

Gatilhos: PR → etapas 1–4; merge na branch de release → 1–7 (+8). Deploy manual aprovado
para a VPS.

## 4. Deploy do contrato Soroban

1. `cargo build --target wasm32-unknown-unknown --release` em `contracts/payorder`.
2. `stellar contract deploy` na Testnet usando a conta admin (segredo fora do repo).
3. `stellar contract invoke ... initialize --admin <ADMIN_PUBKEY>`.
4. Registrar o `CONTRACT_ID` em `SOROBAN_CONTRACT_ID` no ambiente do backend.
5. Versionar o WASM/ID e documentar em `contracts/payorder/README.md`.

> Upgrades do contrato: como ordens são imutáveis por design, um novo contrato pode ser
> deployado para novas ordens; ordens antigas continuam no contrato anterior (estratégia de
> versionamento por `soroban_contract_id` na própria ordem).

## 5. Migrations de banco

- Executadas pelo serviço `migrate` (one-shot) **antes** de subir `api`/`worker`.
- Forward-only, idempotentes; revisadas em PR.
- Backup do banco antes de migrations em VPS (ver §7).

## 6. Estratégia de release e rollback

- **Release:** atualizar `IMAGE_TAG`, rodar `migrate`, `up -d`. Traefik só roteia
  containers saudáveis (healthchecks), reduzindo downtime.
- **Rollback de app:** repointar `IMAGE_TAG` para a versão anterior e `up -d`. Evitar
  migrations destrutivas para manter compatibilidade retroativa N/N-1.
- **Rollback de contrato:** apontar `SOROBAN_CONTRACT_ID` para a versão anterior se
  necessário (novas ordens); ordens existentes permanecem no contrato original.

## 7. Backups e retenção

- **PostgreSQL:** `pg_dump` agendado (diário) + retenção; restauração testada.
- Volumes nomeados (`payorder_pg`, `payorder_redis`) preservados entre deploys.
- Auditoria e eventos retidos conforme política (sem hard delete no MVP).

## 8. Configuração e segredos

- Segredos via variáveis de ambiente da VPS / Docker secrets, **nunca** no repositório.
- Separação por ambiente (local/CI/VPS). `SOROBAN_ADMIN_SECRET`, `JWT_SECRET`,
  `WEBHOOK_SIGNING_SECRET`, credenciais de banco distintos por ambiente.

## 9. Checklist de go-live (Testnet)

- [ ] Contrato deployado e `initialize` executado; `CONTRACT_ID` configurado.
- [ ] Migrations aplicadas; seed mínimo (admin) criado.
- [ ] `/health` e `/ready` verdes; smoke test de criação/consulta de ordem.
- [ ] Domínios resolvendo via Traefik com TLS; CORS correto.
- [ ] Rate limiting, logs e auditoria ativos.
- [ ] Backups configurados.
