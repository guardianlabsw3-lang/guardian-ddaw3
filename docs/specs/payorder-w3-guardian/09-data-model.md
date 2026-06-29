# 09 — Modelo de Dados (PostgreSQL)

Banco relacional **PostgreSQL 16**. A **wallet principal do tenant fica na tabela
`tenants`**. **Não há `tenant_wallets` obrigatória no MVP.** Migrations versionadas
(Drizzle). Todos os IDs em `uuid` (v7 preferível por ordenação temporal). Timestamps em
`timestamptz` (UTC). Valores monetários em `numeric(20,7)` (escala Stellar).

## 1. Tabela `tenants`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `slug` | text | UNIQUE, NOT NULL |
| `name` | text | NOT NULL |
| `legal_name` | text | NOT NULL |
| `document_type` | text | NOT NULL, CHECK in ('CNPJ','CPF','OTHER') |
| `document_number` | text | NOT NULL, UNIQUE |
| `admin_email` | text | NOT NULL |
| `stellar_wallet_public_key` | text | NULL (obrig. para emitir), CHECK formato `^G[A-Z2-7]{55}$` |
| `stellar_network` | text | NOT NULL DEFAULT 'TESTNET', CHECK = 'TESTNET' |
| `default_asset_code` | text | NOT NULL |
| `default_asset_issuer` | text | NULL |
| `status` | text | NOT NULL DEFAULT 'INACTIVE', CHECK in ('ACTIVE','INACTIVE') |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Índices: `UNIQUE(document_number)`, `UNIQUE(slug)`, `INDEX(status)`.
Constraint composta: se `default_asset_code <> 'XLM'` então `default_asset_issuer` NOT NULL
(validada na aplicação; CHECK parcial opcional).

## 2. Tabela `payment_orders`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK → tenants(id), NOT NULL |
| `external_id` | text | NULL |
| `amount` | numeric(20,7) | NOT NULL, CHECK > 0 |
| `asset_code` | text | NOT NULL |
| `asset_issuer` | text | NULL |
| `receiver_wallet_public_key` | text | NOT NULL (**cópia imutável** do tenant) |
| `canonical_payload_hash` | text | NOT NULL (hex 64) |
| `status` | text | NOT NULL, CHECK in ('CREATED','ACTIVE','PAID','EXPIRED','CANCELLED','FAILED') |
| `source` | text | NOT NULL DEFAULT 'manual' |
| `due_date` | date | NULL |
| `description` | text | NULL |
| `public_payment_slug` | text | UNIQUE, NOT NULL |
| `soroban_contract_id` | text | NULL |
| `blockchain_transaction_hash` | text | NULL |
| `metadata` | jsonb | NOT NULL DEFAULT '{}' |
| `correlation_id` | text | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |
| `paid_at` | timestamptz | NULL |

Índices/constraints:
- `UNIQUE(public_payment_slug)`.
- `UNIQUE(tenant_id, external_id)` **WHERE external_id IS NOT NULL** (idempotência por origem).
- `INDEX(tenant_id)`, `INDEX(status)`, `INDEX(due_date) WHERE status='ACTIVE'`,
  `INDEX(blockchain_transaction_hash)`, `INDEX(canonical_payload_hash)`.
- `receiver_wallet_public_key` nunca atualizada após criação (garantido na aplicação).

## 3. Tabela `payment_order_events`

Trilha de eventos do ciclo de vida da ordem (event sourcing leve para auditoria/consulta).

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `payment_order_id` | uuid | FK → payment_orders(id), NOT NULL |
| `event_type` | text | NOT NULL (created, registered, paid, cancelled, expired, failed) |
| `payload` | jsonb | NOT NULL DEFAULT '{}' |
| `correlation_id` | text | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

Índices: `INDEX(payment_order_id, created_at)`, `INDEX(event_type)`.

## 4. Tabela `accepted_assets`

Catálogo de assets aceitos (Testnet). Permite validar `asset_code/issuer` e habilitar
multi-asset futuro sem alterar schema.

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `code` | text | NOT NULL |
| `issuer` | text | NULL (NULL = nativo XLM) |
| `network` | text | NOT NULL DEFAULT 'TESTNET' |
| `sac_address` | text | NULL (endereço do Stellar Asset Contract) |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

Constraint: `UNIQUE(code, issuer, network)`.

## 5. Tabela `blockchain_transactions`

Registro das interações on-chain (registro e pagamento).

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `payment_order_id` | uuid | FK → payment_orders(id), NOT NULL |
| `kind` | text | NOT NULL (register, pay, cancel, expire) |
| `tx_hash` | text | NULL |
| `ledger` | bigint | NULL |
| `status` | text | NOT NULL (pending, submitted, success, failed) |
| `raw_result` | jsonb | NULL (resultado/erro sanitizado) |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Índices: `INDEX(payment_order_id)`, `INDEX(tx_hash)`, `INDEX(status)`.

## 6. Tabela `webhook_deliveries`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `payment_order_id` | uuid | FK → payment_orders(id), NOT NULL |
| `event_type` | text | NOT NULL |
| `target_url` | text | NOT NULL |
| `attempt` | int | NOT NULL DEFAULT 0 |
| `status` | text | NOT NULL (pending, success, failed, exhausted) |
| `request_signature` | text | NULL |
| `response_status` | int | NULL |
| `next_retry_at` | timestamptz | NULL |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

Índices: `INDEX(payment_order_id)`, `INDEX(status, next_retry_at)`.
Idempotência do consumidor: incluir `id` do evento no corpo (já único).

## 7. Tabela `audit_logs`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `actor_type` | text | NOT NULL (admin, api_key, system) |
| `actor_id` | text | NULL |
| `action` | text | NOT NULL |
| `entity_type` | text | NOT NULL (tenant, payment_order, ...) |
| `entity_id` | text | NULL |
| `correlation_id` | text | NULL |
| `diff` | jsonb | NULL (campos não sensíveis) |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

Índices: `INDEX(entity_type, entity_id)`, `INDEX(actor_type, actor_id)`, `INDEX(created_at)`.

## 8. Tabela `admin_users`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `email` | text | UNIQUE, NOT NULL |
| `password_hash` | text | NOT NULL (argon2id) |
| `role` | text | NOT NULL DEFAULT 'admin' |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

## 9. Tabela `api_keys` (integradores)

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `name` | text | NOT NULL |
| `key_prefix` | text | NOT NULL (parte pública para identificação) |
| `key_hash` | text | NOT NULL (hash do segredo) |
| `webhook_secret_hash` | text | NULL |
| `scopes` | text[] | NOT NULL DEFAULT '{}' |
| `allowed_tenant_ids` | uuid[] | NULL (NULL = todos) |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `created_at` / `revoked_at` | timestamptz | |

Índices: `UNIQUE(key_prefix)`, `INDEX(is_active)`.

## 10. Tabela `idempotency_keys`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | uuid | PK |
| `key` | text | NOT NULL |
| `endpoint` | text | NOT NULL |
| `request_hash` | text | NOT NULL |
| `response_status` | int | NULL |
| `response_body` | jsonb | NULL |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `expires_at` | timestamptz | NOT NULL |

Constraint: `UNIQUE(key, endpoint)`. Limpeza periódica por `expires_at` (worker).
(Redis pode atuar como cache rápido; PostgreSQL é a fonte durável.)

## 11. Relacionamentos

```text
tenants 1───∞ payment_orders 1───∞ payment_order_events
                      │
                      ├───∞ blockchain_transactions
                      └───∞ webhook_deliveries
accepted_assets (catálogo)         audit_logs (transversal)
admin_users / api_keys (acesso)    idempotency_keys (transversal)
```

## 12. Estratégias

- **Idempotência:** `UNIQUE(tenant_id, external_id)` + tabela `idempotency_keys` por header.
- **Controle de status:** coluna `status` com CHECK; transições validadas no domínio.
- **Preservação histórica:** `receiver_wallet_public_key` copiada e imutável na ordem.
- **Soft policies:** sem hard delete de ordens/tenants no MVP (apenas status); auditoria
  preserva histórico.
- **Migrations:** versionadas, idempotentes, executadas por serviço dedicado no Compose.
- **Rastreabilidade:** `correlation_id` propagado para ordens, eventos e auditoria.
