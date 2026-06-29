# 03 — Modelo de Domínio

DDD **simples**: dois agregados principais (`Tenant`, `PaymentOrder`), value objects para
conceitos imutáveis e eventos de domínio. O domínio é **puro** (sem dependência de
frameworks, banco ou Stellar SDK), tornando-o 100% testável por unidade.

## 1. Linguagem ubíqua (glossário)

| Termo | Significado |
|-------|-------------|
| **Tenant** | Empresa/sistema recebedor com wallet Stellar Testnet vinculada. |
| **Payment Order** | Cobrança que vira ordem de pagamento Web3 verificável. |
| **Receiver Wallet** | Wallet destino, derivada do tenant e **copiada** para a ordem. |
| **Canonical Payload** | Serialização determinística dos dados relevantes da ordem. |
| **Order Hash** | SHA-256 do canonical payload, registrado on-chain. |
| **Public Slug** | Identificador opaco do link público de pagamento. |
| **Asset** | Par `(code, issuer)`; para XLM nativo, `issuer` é nulo. |

## 2. Agregados

### 2.1 Agregado `Tenant` (raiz: `Tenant`)

Responsável por manter a identidade do recebedor e sua wallet destino.

```text
Tenant
├── id: TenantId
├── slug: Slug
├── name: string
├── legalName: string
├── document: Document            (VO: type + number, valida CNPJ)
├── adminEmail: Email
├── wallet: StellarAccount | null (VO: publicKey + network)
├── defaultAsset: Asset           (VO: code + issuer?)
├── status: TenantStatus          (ACTIVE | INACTIVE)
├── createdAt / updatedAt
```

Comportamentos (métodos de domínio):

- `assignWallet(publicKey, network)` — valida e vincula wallet; bloqueia troca se houver
  ordens ativas (regra orquestrada pela aplicação consultando ordens).
- `activate()` / `deactivate()`.
- `canIssueOrders(): boolean` — `status == ACTIVE && wallet != null`.

Invariantes:
- `network` da wallet deve ser `TESTNET` no MVP.
- `document` válido conforme `document_type`.

### 2.2 Agregado `PaymentOrder` (raiz: `PaymentOrder`)

Responsável pelo ciclo de vida da cobrança.

```text
PaymentOrder
├── id: PaymentOrderId
├── tenantId: TenantId
├── externalId: string | null
├── amount: Money                 (VO: valor decimal + asset)
├── asset: Asset
├── receiverWallet: StellarPublicKey   (cópia imutável da wallet do tenant)
├── canonicalPayloadHash: Sha256Hash
├── status: OrderStatus
├── dueDate: Date | null
├── description: string | null
├── publicSlug: Slug
├── sorobanContractId: string | null
├── blockchainTxHash: string | null
├── metadata: Record<string, unknown>
├── source: OrderSource           (manual | api | erp | ...)
├── createdAt / updatedAt / paidAt
└── events: PaymentOrderEvent[]
```

Comportamentos:

- `static create(...)` — fábrica que valida invariantes, fixa `receiverWallet` (cópia),
  calcula `canonicalPayloadHash`, define status inicial e gera `publicSlug`.
- `markRegisteredOnChain(contractId, txHash)` — `CREATED → ACTIVE`.
- `markPaid(txHash, paidAt)` — `ACTIVE → PAID` (idempotente).
- `cancel(by)` — `ACTIVE → CANCELLED`.
- `expire()` — `ACTIVE → EXPIRED`.
- `markFailed(reason)` — `ACTIVE → FAILED`.
- `assertPayable()` — garante `ACTIVE` e não vencida.

Invariantes (ver RN em `02-requirements.md`):
- `receiverWallet`, `amount`, `asset`, `canonicalPayloadHash` **imutáveis** após criação.
- Transições de estado só pelas permitidas (máquina de estados abaixo).

## 3. Máquina de estados da `PaymentOrder`

```text
        create()                 registerOnChain()
  ( · ) ─────────▶ CREATED ───────────────────────▶ ACTIVE
                                                       │
                          markPaid()                   │
              PAID ◀──────────────────────────────────┤
                                                       │
                          cancel()                     │
         CANCELLED ◀──────────────────────────────────┤
                                                       │
                          expire()                     │
           EXPIRED ◀──────────────────────────────────┤
                                                       │
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

Estados terminais: `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`. Não há transições saindo deles.

> Observação: `CREATED` é um estado **transitório off-chain** enquanto a ordem aguarda
> confirmação do registro on-chain. A consulta pública só expõe a ordem como pagável quando
> `ACTIVE`.

## 4. Value Objects (VO)

| VO | Regras |
|----|--------|
| `TenantId` / `PaymentOrderId` | UUID v4/v7; imutável. |
| `Slug` | URL-safe, único; para `publicSlug` é opaco e não sequencial (ex.: base58 de 22+ chars). |
| `Document` | `{ type: 'CNPJ' \| 'CPF' \| 'OTHER', number }`; valida dígitos do CNPJ/CPF. |
| `Email` | RFC 5322 simplificado. |
| `StellarPublicKey` | ed25519, prefixo `G`, 56 chars, checksum válido (strkey). |
| `StellarAccount` | `{ publicKey: StellarPublicKey, network: 'TESTNET' }`. |
| `Asset` | `{ code, issuer? }`; XLM nativo → `issuer = null`; code 1–12 chars alfanum. |
| `Money` | valor decimal com escala fixa (string para precisão) + `Asset`; sem float. |
| `Sha256Hash` | 32 bytes; hex de 64 chars minúsculos. |

## 5. Payload canônico e hash

O **canonical payload** é uma serialização **determinística** dos campos relevantes da
ordem, garantindo que o mesmo conteúdo sempre produza o mesmo hash.

Regras de canonicalização:
- JSON com **chaves ordenadas lexicograficamente**, sem espaços, UTF-8.
- `amount` como string decimal de escala fixa (ex.: `"150.0000000"` — 7 casas, padrão Stellar).
- `asset_issuer` ausente → string vazia `""` (nunca omitir a chave).
- Datas em ISO-8601 UTC (`due_date` apenas a data, sem hora, se aplicável).
- Campos incluídos no hash (relevantes para integridade do pagamento):

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

`canonical_payload_hash = SHA256(canonical_json_bytes)` (hex). Esse hash é registrado
on-chain e exibido na tela pública para verificação. `description` e `metadata` **não**
entram no hash (não são determinantes do pagamento), mas ficam no banco e na auditoria.

> A função de canonicalização vive em `packages/shared` e é usada **identicamente** por
> API, worker e testes para evitar divergência.

## 6. Eventos de domínio

| Evento | Quando | Payload |
|--------|--------|---------|
| `TenantCreated` | Tenant cadastrado | tenantId, document |
| `TenantWalletAssigned` | Wallet vinculada/atualizada | tenantId, publicKey |
| `PaymentOrderCreated` | Ordem criada off-chain | orderId, tenantId, amount, hash |
| `PaymentOrderRegistered` | Registrada on-chain | orderId, contractId, txHash |
| `PaymentOrderPaid` | Pagamento confirmado | orderId, txHash, paidAt |
| `PaymentOrderCancelled` | Cancelada | orderId, by |
| `PaymentOrderExpired` | Expirada | orderId |
| `PaymentOrderFailed` | Falha | orderId, reason |

Eventos são persistidos em `payment_order_events` e disparam **webhooks** e **auditoria**.

## 7. Ports (interfaces) do domínio/aplicação

Definidos na camada de aplicação; implementados na infraestrutura (Hexagonal):

- `TenantRepository`, `PaymentOrderRepository`
- `StellarLedgerPort` (consulta de conta/transação, submissão)
- `SorobanContractPort` (register / get / cancel da ordem on-chain)
- `HashService` (canonicalização + SHA-256)
- `SlugGenerator`
- `WebhookDispatcherPort`
- `Clock` (tempo testável)
- `AuditLogPort`
- `EventPublisher`
