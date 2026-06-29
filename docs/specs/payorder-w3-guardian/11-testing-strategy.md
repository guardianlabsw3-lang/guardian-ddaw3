# 11 — Estratégia de Testes

Testes automatizados **desde o início**. Pirâmide: muitos testes de unidade (domínio puro),
camada intermediária de integração/contrato, poucos E2E.

## 1. Níveis de teste

| Nível | Alvo | Ferramentas |
|-------|------|-------------|
| Unidade (domínio) | Entidades, VOs, máquina de estados, canonicalização/hash | Vitest/Jest |
| Unidade (contrato) | Métodos do contrato Soroban | `soroban-sdk` test harness (`cargo test`) |
| Integração (backend+DB) | Repositórios, use cases com PostgreSQL real | Vitest + Testcontainers |
| Contrato de API | Conformidade com OpenAPI | Dredd / schemathesis / testes baseados no `openapi.yaml` |
| Integração Stellar | Registro/pagamento na Testnet controlada | SDK + conta de teste + Friendbot |
| E2E | Fluxo completo painel/API → pagamento | Playwright (web) + harness backend |

## 2. Cobertura mínima recomendada

- Domínio (regras/VOs/estado): **≥ 90%**.
- Contrato Soroban: **≥ 85%** de linhas/branches dos métodos públicos.
- Backend geral: **≥ 80%**.
- Gate de CI falha abaixo dos limites.

## 3. Testes de domínio (exemplos)

- `PaymentOrder.create` fixa `receiver_wallet` (cópia) e calcula hash determinístico.
- Transições válidas/ inválidas da máquina de estados.
- Imutabilidade de `amount`/`asset`/`receiver_wallet`/`hash`.
- Canonicalização: mesma entrada → mesmo hash; ordem de chaves irrelevante; `issuer` nulo
  vira `""`; escala de `amount` normalizada.
- `Document`/`StellarPublicKey`/`Asset` válidos e inválidos.

## 4. Testes do contrato Soroban (obrigatórios)

Ver lista detalhada em `07-smart-contract.md §8`. Mínimo:
- registrar/duplicar, pagar válido, valor/asset divergente, duplo pagamento, cancelada,
  expirada, autorização de cancel/expire, consulta, imutabilidade.

## 5. Testes de integração backend + banco

- Repositórios CRUD com PostgreSQL (Testcontainers).
- Unicidade `(tenant_id, external_id)` e idempotência por `Idempotency-Key`.
- Bloqueio de troca de wallet com ordens ativas.
- Persistência de eventos e auditoria.

## 6. Testes de contrato de API

- Cada endpoint validado contra `openapi/payorder-api.yaml` (request/response/status).
- Erros padronizados (envelope, códigos, status).

## 7. Testes de integração com Stellar Testnet (ambiente controlado)

- Conta admin de teste e contas pagadoras geradas via `Keypair.random()` + Friendbot.
- Registro de ordem on-chain e leitura via `get_order`.
- Pagamento assinado e verificação de `PAID`.
- Marcados como suíte separada (mais lentos / dependentes de rede); podem rodar em CI noturno
  ou sob flag.

## 8. Fluxos E2E mínimos (obrigatórios)

1. Criar tenant.
2. Cadastrar wallet Stellar Testnet no tenant.
3. Criar Payment Order informando **apenas tenant + valor**.
4. Sistema **resolve automaticamente** a wallet destino.
5. Consultar link público.
6. Conectar wallet pagadora.
7. Pagar.
8. Marcar como `PAID`.
9. **Impedir pagamento duplicado**.

## 9. Testes de erro (obrigatórios)

- tenant inexistente; CNPJ sem tenant vinculado; tenant sem wallet; wallet do tenant
  inválida; ordem inexistente; ordem expirada; valor divergente; asset divergente; hash
  divergente; pagar ordem já paga; cancelar ordem paga; ordem duplicada; integração sem
  autenticação; **criar cobrança informando wallet manualmente**; **alterar wallet do
  tenant com ordem ativa**.

## 10. Testes por funcionalidade (mapa)

- Onboarding de tenant (`05`).
- Cadastro/atualização de wallet no tenant (`06`).
- Criação manual de cobrança (`16`).
- Criação via API (`08`/`16`).
- Integração ERP simulada (`16`) — mock do tenant por documento + callback.

## 11. Como rodar localmente (via Docker)

```bash
# Sobe dependências e roda toda a suíte backend + integração
make test            # ou: docker compose -f infra/docker/docker-compose.local.yml run --rm api npm test

# Testes do contrato Soroban
make test-contract   # cargo test em contracts/payorder

# E2E web
make test-e2e        # Playwright contra api+web no Compose
```

Convenções:
- Banco de teste efêmero (Testcontainers ou serviço Postgres dedicado no Compose).
- Suítes que tocam a Testnet ficam atrás de flag `RUN_STELLAR_TESTS=1`.
- CI executa: lint → unidade → integração → contrato → contrato-de-API → (noturno) Stellar/E2E.

## 12. Dados de teste e fixtures

- Factories para `Tenant`/`PaymentOrder` no domínio.
- Seeds determinísticos para Postgres em ambiente de teste.
- `Clock` injetável para testar expiração sem esperar tempo real.
