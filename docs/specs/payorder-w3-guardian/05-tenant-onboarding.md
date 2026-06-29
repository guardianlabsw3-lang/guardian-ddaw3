# 05 — Onboarding de Tenant

## 1. Objetivo

Cadastrar o **tenant recebedor** e vincular sua **wallet Stellar Testnet** diretamente ao
cadastro, de modo que cobranças futuras resolvam o destino automaticamente.

## 2. Campos do tenant

| Campo | Tipo | Obrigatório | Observações |
|-------|------|-------------|-------------|
| `tenant_id` / `id` | uuid | sim (gerado) | Identidade interna. |
| `slug` | string | sim (gerado/derivado) | URL-safe, único. |
| `name` | string | sim | Nome de exibição. |
| `legal_name` | string | sim | Razão social. |
| `document_type` | enum | sim | `CNPJ` \| `CPF` \| `OTHER`. |
| `document_number` | string | sim | Único; validado conforme tipo. |
| `admin_email` | string | sim | Contato administrativo. |
| `stellar_wallet_public_key` | string | não (na criação) | `G...`; obrigatório para emitir cobranças. |
| `stellar_network` | enum | sim | `TESTNET` (fixo no MVP). |
| `default_asset_code` | string | sim | Ex.: `XLM`. |
| `default_asset_issuer` | string | condicional | Nulo para XLM nativo; obrigatório para asset emitido. |
| `status` | enum | sim | `ACTIVE` \| `INACTIVE` (default conforme política). |
| `created_at` / `updated_at` | timestamp | sim | Auditoria. |

> A wallet pode ser vinculada na criação **ou** em um passo seguinte. O tenant só consegue
> emitir cobranças quando está `ACTIVE` **e** possui `stellar_wallet_public_key`.

## 3. Fluxo de onboarding

```text
1. Admin cria tenant (name, legal_name, document, admin_email, default_asset).
2. Sistema valida documento e unicidade.
3. Sistema cria tenant com status conforme política (ver §6) e sem wallet (ou com wallet).
4. Vinculação de wallet (UC-02):
     - Opção B (recomendada): admin/tenant informa a public key existente.
     - Opção A (opcional): produto gera wallet Testnet e a vincula.
5. Sistema valida a public key (strkey ed25519) e (Opção A) financia via Friendbot.
6. Tenant passa a poder emitir cobranças.
```

## 4. Validações

- `document_number` válido para o `document_type` (dígitos verificadores de CNPJ/CPF) e
  **único** no sistema.
- `admin_email` em formato válido.
- `default_asset`: se `code != XLM`, exigir `default_asset_issuer` válido (public key de issuer).
- `stellar_wallet_public_key`: strkey válida, prefixo `G`, 56 chars, checksum correto.
- `stellar_network = TESTNET` (qualquer outro valor rejeitado no MVP).

## 5. Endpoints relacionados

Ver `08-api-contracts.md`:
- `POST /api/tenants` — cria tenant.
- `GET /api/tenants/{id}` / `GET /api/tenants` — consulta/lista.
- `POST /api/tenants/{id}/activate` / `.../deactivate` — status.
- `PUT /api/tenants/{id}/wallet` — cadastra/atualiza wallet (regras em `06`).
- `GET /api/tenants/{id}/wallet` — consulta wallet.

## 6. Política de ativação (MVP)

Recomendação MVP: tenant é criado `INACTIVE` e passa a `ACTIVE` **somente após** ter uma
wallet válida vinculada (ativação manual pelo admin ou automática na vinculação da wallet).
Isso garante a invariante **RN-01** (não emitir cobrança sem wallet/ativo) já no onboarding.

## 7. Erros esperados

| Situação | HTTP | Código |
|----------|------|--------|
| Documento inválido | 422 | `INVALID_DOCUMENT` |
| Documento já cadastrado | 409 | `TENANT_DOCUMENT_CONFLICT` |
| E-mail inválido | 422 | `INVALID_EMAIL` |
| Asset issuer ausente para asset emitido | 422 | `ASSET_ISSUER_REQUIRED` |
| Public key inválida | 422 | `INVALID_STELLAR_PUBLIC_KEY` |
| Rede diferente de TESTNET | 422 | `UNSUPPORTED_NETWORK` |

## 8. Auditoria

Eventos `TenantCreated`, `TenantWalletAssigned`, `TenantActivated/Deactivated` registrados
em `audit_logs` com `correlation_id`, ator, e diff de campos não sensíveis.

## 9. Testes (resumo)

- Criação válida; documento inválido/duplicado; e-mail inválido.
- Vinculação de wallet válida/ inválida; rede inválida.
- Tenant sem wallet **não** pode emitir cobrança.
- Ativação automática após wallet válida (conforme §6).
