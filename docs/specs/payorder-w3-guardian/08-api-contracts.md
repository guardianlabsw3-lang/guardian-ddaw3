# 08 — Contratos de API REST

Contrato completo em `openapi/payorder-api.yaml`. Este documento descreve convenções,
endpoints e regras. Base path: `/api`. Formato: JSON. Datas: ISO-8601 UTC.

## 1. Convenções gerais

- **Versionamento:** prefixo `/api` no MVP; evolução para `/api/v1` documentada no OpenAPI.
- **Autenticação:**
  - **Admin (painel):** sessão/JWT Bearer (`Authorization: Bearer <token>`).
  - **Integradores (API/ERP):** **API key** por cliente (`X-Api-Key`) **ou** client
    credentials (OAuth2 client_credentials) — MVP usa **API key** + segredo HMAC para
    webhooks. Cada key tem escopo e tenant(s) permitidos.
- **Idempotência:** header `Idempotency-Key` obrigatório em criação de ordem; também há
  idempotência natural por `(tenant_id, external_id)`.
- **Correlação:** header `X-Request-Id` (ou gerado); propagado em logs e respostas.
- **Rate limiting:** por API key/IP (ver `10-security.md`); resposta `429` com `Retry-After`.
- **Erros:** envelope padrão:

```json
{
  "error": {
    "code": "TENANT_WALLET_NOT_SET",
    "message": "Tenant has no Stellar wallet configured",
    "request_id": "req_01H...",
    "details": {}
  }
}
```

- **Status codes:** `200` ok, `201` criado, `202` aceito (registro on-chain assíncrono),
  `400` payload inválido, `401` não autenticado, `403` sem permissão, `404` não encontrado,
  `409` conflito/estado inválido, `422` validação de domínio, `429` rate limit, `5xx` erro.

## 2. Endpoints — Tenants (admin)

| Método | Caminho | Descrição |
|--------|---------|-----------|
| POST | `/api/tenants` | Cria tenant. |
| GET | `/api/tenants` | Lista (paginação, filtro por status/documento). |
| GET | `/api/tenants/{id}` | Consulta tenant. |
| POST | `/api/tenants/{id}/activate` | Ativa tenant. |
| POST | `/api/tenants/{id}/deactivate` | Inativa tenant. |
| PUT | `/api/tenants/{id}/wallet` | Cadastra/atualiza wallet (regras em `06`). |
| GET | `/api/tenants/{id}/wallet` | Consulta wallet do tenant. |

### Exemplo — criar tenant

```http
POST /api/tenants
Authorization: Bearer <admin-jwt>
```
```json
{
  "name": "ACME Pagamentos",
  "legal_name": "ACME Pagamentos LTDA",
  "document_type": "CNPJ",
  "document_number": "12345678000199",
  "admin_email": "fin@acme.com.br",
  "default_asset_code": "XLM",
  "default_asset_issuer": null,
  "stellar_wallet_public_key": "GBPAY...TENANT",
  "stellar_network": "TESTNET"
}
```

### Exemplo — atualizar wallet

```http
PUT /api/tenants/{id}/wallet
```
```json
{ "stellar_wallet_public_key": "GBNEW...WALLET", "stellar_network": "TESTNET" }
```
Bloqueado com `409 WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS` se houver ordens ativas.

## 3. Endpoints — Payment Orders

| Método | Caminho | Auth | Descrição |
|--------|---------|------|-----------|
| POST | `/api/payment-orders` | admin/API key | Cria cobrança (manual/API/ERP). |
| GET | `/api/payment-orders` | admin/API key | Lista (filtros: status, tenant, external_id). |
| GET | `/api/payment-orders/{id}` | admin/API key | Consulta por id. |
| GET | `/api/payment-orders/{id}/status` | admin/API key | Status on-chain/off-chain. |
| GET | `/api/payment-orders/{id}/events` | admin/API key | Eventos da ordem. |
| POST | `/api/payment-orders/{id}/cancel` | admin | Cancela ordem `ACTIVE`. |
| POST | `/api/payment-orders/{id}/webhooks/resend` | admin/API key | Reenvia webhook. |
| GET | `/api/public/payment-orders/{slug}` | público | Dados públicos para pagamento. |

### 3.1 Criar Payment Order

```http
POST /api/payment-orders
X-Api-Key: <key>
Idempotency-Key: 9f1c2b...   (obrigatório)
```

Payload (origem painel/API — por `tenant_id`):
```json
{
  "tenant_id": "tenant_123",
  "amount": "150.00",
  "asset_code": "XLM",
  "due_date": "2026-07-10",
  "description": "Cobrança gerada no PayOrder W3 Guardian",
  "external_id": "ORDER-123456",
  "metadata": { "source": "manual", "customer_reference": "CLIENTE-999" }
}
```

Payload (origem ERP — por `tenant_document`):
```json
{
  "source": "ERP",
  "external_id": "ERP-123456",
  "tenant_document": "12345678000199",
  "amount": "150.00",
  "asset_code": "XLM",
  "due_date": "2026-07-10",
  "description": "Cobrança gerada pelo ERP",
  "callback_url": "https://erp.example.com/webhook/payments",
  "metadata": { "invoice_number": "NF-1001", "customer_reference": "CLIENTE-999" }
}
```

**Regras (idênticas para todas as origens):**
1. Resolver tenant por `tenant_id` **ou** `slug` **ou** `tenant_document`.
2. Validar tenant `ACTIVE`.
3. Validar que o tenant possui `stellar_wallet_public_key`.
4. **Recuperar automaticamente** a wallet do tenant (cópia para a ordem).
5. `asset_code` ausente → usar `default_asset_code`/`default_asset_issuer` do tenant.
6. **Rejeitar** qualquer campo de wallet no payload (`422 WALLET_NOT_ALLOWED_ON_ORDER`).
7. Gerar payload canônico + hash SHA-256.
8. Persistir ordem (`CREATED`), gerar `public_payment_slug`.
9. Enfileirar registro no contrato Soroban (assíncrono) → `ACTIVE` ao confirmar.
10. Responder com a ordem e o link público.

Resposta `202 Accepted` (registro assíncrono):
```json
{
  "id": "0f9d2a...",
  "tenant_id": "tenant_123",
  "external_id": "ORDER-123456",
  "amount": "150.0000000",
  "asset_code": "XLM",
  "asset_issuer": null,
  "receiver_wallet_public_key": "GBPAY...TENANT",
  "canonical_payload_hash": "5b1c...e9",
  "status": "CREATED",
  "due_date": "2026-07-10",
  "public_payment_slug": "p_8sKd9...",
  "public_payment_url": "https://payorder.example/p/p_8sKd9...",
  "soroban_contract_id": null,
  "created_at": "2026-06-29T12:00:00Z"
}
```

### 3.2 Consulta pública

```http
GET /api/public/payment-orders/{slug}
```
```json
{
  "status": "ACTIVE",
  "network": "TESTNET",
  "receiver": { "name": "ACME Pagamentos", "document": "12.345.678/0001-99",
                "wallet_public_key": "GBPAY...TENANT" },
  "amount": "150.0000000",
  "asset_code": "XLM",
  "asset_issuer": null,
  "due_date": "2026-07-10",
  "order_id": "0f9d2a...",
  "canonical_payload_hash": "5b1c...e9",
  "soroban_contract_id": "CA...XYZ",
  "explorer_url": "https://stellar.expert/explorer/testnet/contract/CA...XYZ"
}
```
Não expõe dados sensíveis (e-mail admin, metadata interna, API keys).

## 4. Idempotência

- `Idempotency-Key` é persistido por (key, endpoint, hash do corpo) por uma janela (ex.:
  24h). Reenvio idêntico retorna a **mesma resposta**; corpo divergente com mesma key →
  `409 IDEMPOTENCY_KEY_CONFLICT`.
- `(tenant_id, external_id)` único: segunda criação retorna a ordem existente (`200`) em vez
  de duplicar.

## 5. Webhooks (saída → integradores)

- Disparados em `PaymentOrderRegistered`, `PaymentOrderPaid`, `PaymentOrderCancelled`,
  `PaymentOrderExpired`, `PaymentOrderFailed`.
- Destino: `callback_url` da ordem (ERP) ou URL configurada por API key.
- **Assinatura:** header `X-PayOrder-Signature: t=<ts>,v1=<hmac_sha256>` (HMAC do corpo com
  o segredo do cliente). O integrador valida e checa tolerância de tempo (anti-replay).
- **Entrega:** POST JSON; espera `2xx`. Retentativas com backoff exponencial (ex.: 1m, 5m,
  30m, 2h, 6h — até N tentativas). Persistidas em `webhook_deliveries`.
- **Reenvio manual:** `POST /api/payment-orders/{id}/webhooks/resend`.

Exemplo de corpo:
```json
{
  "event": "payment_order.paid",
  "id": "evt_01H...",
  "occurred_at": "2026-06-29T12:34:56Z",
  "data": {
    "payment_order_id": "0f9d2a...",
    "external_id": "ORDER-123456",
    "tenant_id": "tenant_123",
    "status": "PAID",
    "blockchain_transaction_hash": "abc123...",
    "paid_at": "2026-06-29T12:34:50Z"
  }
}
```

## 6. Autenticação entre sistemas

- **API key** (`X-Api-Key`): identifica o cliente integrador; mapeada a escopos
  (`orders:create`, `orders:read`, ...) e a tenant(s) permitidos.
- Segredo HMAC associado para assinar webhooks e (opcional) validar requisições.
- Evolução: OAuth2 client_credentials com tokens de curta duração.
- Erros de auth: `401 UNAUTHENTICATED`, `403 FORBIDDEN_SCOPE`.

## 7. Validação de payload

- Toda entrada validada por **schemas zod** compartilhados (`packages/shared`).
- `amount`: string decimal positiva, escala ≤ 7; normalizada para 7 casas.
- `due_date`: data futura (ou ausente).
- `external_id`: string ≤ 64 chars; usada na idempotência.
- `metadata`: objeto JSON ≤ N KB; sem campos reservados de wallet.

## 8. OpenAPI

`openapi/payorder-api.yaml` é a fonte de verdade do contrato; usada para geração de
client/SDK, testes de contrato e documentação. CI valida o spec e o backend contra ele.
