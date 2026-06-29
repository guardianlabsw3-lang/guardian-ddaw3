# 07 — Smart Contract Soroban (PayOrder)

Contrato em **Rust** (`soroban-sdk`) que registra e governa o ciclo de vida da Payment
Order on-chain. É a **autoridade do status de pagamento**. Opera na **Stellar Testnet**.

> Os exemplos de código abaixo são **ilustrativos** da SPEC, não a implementação final.

## 1. Responsabilidades

- Registrar uma Payment Order (id, hash, tenant, wallet destino, valor, asset, status).
- Evitar **duplicidade** de ordem (mesmo `order_id`).
- Guardar o **hash** canônico da cobrança.
- Permitir **pagamento apenas quando `ACTIVE`**, com valor e asset corretos.
- Marcar como **`PAID`** após pagamento válido; impedir pagamento duplicado.
- Permitir **cancelamento** apenas por **autoridade autorizada**.
- Permitir **expiração** de ordens vencidas.
- Permitir **consulta pública** da ordem.
- **Emitir eventos** relevantes.

## 2. Estruturas de dados

```rust
#[contracttype]
#[derive(Clone, PartialEq, Eq)]
pub enum OrderStatus { Active, Paid, Expired, Cancelled, Failed }

#[contracttype]
#[derive(Clone)]
pub struct AssetInfo {
    pub code: Symbol,            // ex.: "XLM"
    pub issuer: Option<Address>, // None para nativo
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentOrder {
    pub order_id: BytesN<32>,        // id da ordem (uuid/hash) em 32 bytes
    pub data_hash: BytesN<32>,       // SHA-256 do payload canônico
    pub tenant_ref: BytesN<32>,      // referência do tenant destino (hash/uuid)
    pub receiver: Address,           // wallet destino do tenant recebedor
    pub amount: i128,                // valor em stroops/menor unidade do asset
    pub asset: AssetInfo,            // asset aceito
    pub status: OrderStatus,
    pub due_ledger: u32,             // ledger de expiração (0 = sem vencimento)
    pub paid_by: Option<Address>,    // pagador (após PAID)
    pub created_at: u64,             // timestamp do ledger
    pub paid_at: Option<u64>,
}

#[contracttype]
pub enum DataKey {
    Admin,                  // autoridade autorizada (cancel/expire/admin)
    Order(BytesN<32>),      // PaymentOrder por order_id
}
```

> `amount` é inteiro (`i128`) na menor unidade (stroops para XLM, 7 casas). A conversão
> decimal→inteiro é feita no backend e validada contra o `data_hash`.

## 3. Métodos públicos

| Método | Autoriza | Descrição |
|--------|----------|-----------|
| `initialize(admin: Address)` | deployer | Define a autoridade administrativa (1x). |
| `register_order(order_id, data_hash, tenant_ref, receiver, amount, asset, due_ledger)` | admin | Cria a ordem `ACTIVE`. Falha se `order_id` já existe. |
| `get_order(order_id) -> PaymentOrder` | público | Consulta a ordem. |
| `pay(order_id, payer: Address, amount, asset)` | payer (`require_auth`) | Paga a ordem: valida estado/valor/asset/vencimento; transfere via Stellar Asset Contract; marca `PAID`. |
| `cancel_order(order_id)` | admin | `ACTIVE → CANCELLED`. |
| `expire_order(order_id)` | admin ou qualquer um se vencido | `ACTIVE → EXPIRED` quando `due_ledger` ultrapassado. |
| `mark_failed(order_id, reason)` | admin | `ACTIVE → FAILED`. |

### 3.1 Esboço de `register_order`

```rust
pub fn register_order(env: Env, order_id: BytesN<32>, data_hash: BytesN<32>,
    tenant_ref: BytesN<32>, receiver: Address, amount: i128,
    asset: AssetInfo, due_ledger: u32) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    if env.storage().persistent().has(&DataKey::Order(order_id.clone())) {
        panic_with_error!(&env, Error::OrderAlreadyExists);
    }
    if amount <= 0 { panic_with_error!(&env, Error::InvalidAmount); }
    let order = PaymentOrder {
        order_id: order_id.clone(), data_hash, tenant_ref, receiver,
        amount, asset, status: OrderStatus::Active, due_ledger,
        paid_by: None, created_at: env.ledger().timestamp(), paid_at: None,
    };
    env.storage().persistent().set(&DataKey::Order(order_id.clone()), &order);
    env.events().publish((symbol_short!("registered"), order_id), (receiver, amount));
}
```

### 3.2 Esboço de `pay`

```rust
pub fn pay(env: Env, order_id: BytesN<32>, payer: Address, amount: i128, asset: AssetInfo) {
    payer.require_auth();
    let mut order: PaymentOrder = env.storage().persistent()
        .get(&DataKey::Order(order_id.clone()))
        .unwrap_or_else(|| panic_with_error!(&env, Error::OrderNotFound));

    if order.status != OrderStatus::Active { panic_with_error!(&env, Error::OrderNotActive); }
    if order.due_ledger != 0 && env.ledger().sequence() > order.due_ledger {
        panic_with_error!(&env, Error::OrderExpired);
    }
    if amount != order.amount { panic_with_error!(&env, Error::AmountMismatch); }
    if asset != order.asset { panic_with_error!(&env, Error::AssetMismatch); }

    // Transferência via Stellar Asset Contract (SAC) do asset configurado
    let token = token::Client::new(&env, &resolve_sac_address(&env, &order.asset));
    token.transfer(&payer, &order.receiver, &amount);

    order.status = OrderStatus::Paid;
    order.paid_by = Some(payer.clone());
    order.paid_at = Some(env.ledger().timestamp());
    env.storage().persistent().set(&DataKey::Order(order_id.clone()), &order);
    env.events().publish((symbol_short!("paid"), order_id), (payer, amount));
}
```

## 4. Regras de autorização

- `initialize`/`register_order`/`cancel_order`/`mark_failed`: exigem `admin.require_auth()`.
- `pay`: exige `payer.require_auth()` — somente o dono da wallet pagadora autoriza a saída.
- `get_order`: público (somente leitura).
- `expire_order`: admin **ou** qualquer chamador quando o vencimento já passou (a expiração
  é objetivamente verificável on-chain).

## 5. Eventos emitidos

| Evento (topic) | Dados | Quando |
|----------------|-------|--------|
| `registered` | `(order_id) -> (receiver, amount)` | Ordem criada. |
| `paid` | `(order_id) -> (payer, amount)` | Pagamento confirmado. |
| `cancelled` | `(order_id)` | Cancelamento. |
| `expired` | `(order_id)` | Expiração. |
| `failed` | `(order_id) -> (reason)` | Falha. |

O worker do backend assina/consulta esses eventos para sincronizar o status off-chain.

## 6. Estados e transições

Estados: `ACTIVE`, `PAID`, `EXPIRED`, `CANCELLED`, `FAILED` (terminais exceto `ACTIVE`).

```text
register_order  → ACTIVE
ACTIVE  --pay-->        PAID
ACTIVE  --expire-->     EXPIRED
ACTIVE  --cancel-->     CANCELLED
ACTIVE  --mark_failed-->FAILED
```

> `CREATED` é estado **off-chain** (pré-registro); on-chain a ordem nasce `ACTIVE`.

## 7. Erros do contrato

```rust
#[contracterror]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    OrderAlreadyExists = 4,
    OrderNotFound = 5,
    OrderNotActive = 6,      // paga/cancelada/expirada/falha
    OrderExpired = 7,
    AmountMismatch = 8,
    AssetMismatch = 9,
    InvalidAmount = 10,
}
```

O contrato deve impedir explicitamente:
- pagamento duplicado (`OrderNotActive` ao tentar pagar `PAID`);
- pagamento de ordem cancelada/expirada (`OrderNotActive`/`OrderExpired`);
- valor divergente (`AmountMismatch`) e asset divergente (`AssetMismatch`);
- alteração indevida da wallet destino e do valor — **não há método** que altere
  `receiver`/`amount`/`data_hash` após `register_order` (imutáveis por design).

## 8. Testes unitários do contrato

Usando o test harness do `soroban-sdk` (`Env::default()`, mock auth):

- `register_order` cria `ACTIVE`; segundo registro com mesmo id → `OrderAlreadyExists`.
- `pay` válido → `PAID`, transfere e emite `paid`.
- `pay` com valor divergente → `AmountMismatch`; asset divergente → `AssetMismatch`.
- `pay` em ordem `PAID` → `OrderNotActive` (anti-duplo pagamento).
- `pay` em ordem `CANCELLED`/`EXPIRED` → erro correspondente.
- `pay` após `due_ledger` → `OrderExpired`.
- `cancel_order` por não-admin → `Unauthorized`; por admin → `CANCELLED`.
- `expire_order` antes do vencimento por não-admin → falha; após vencimento → `EXPIRED`.
- `get_order` retorna dados corretos; `OrderNotFound` para id inexistente.
- Ausência de método para mutar `receiver`/`amount` (garantia de imutabilidade).

## 9. Integração com o backend

- O backend (`SorobanContractAdapter`) chama `register_order` (assinado pela conta admin do
  produto), consulta `get_order` e observa eventos.
- O **pagamento** (`pay`) é montado e **assinado no frontend** pela wallet do pagador
  (não custodial). O backend apenas observa o resultado on-chain e concilia.
- `tenant_ref` e `order_id` são derivados de forma determinística (ex.: hash do uuid) para
  caber em `BytesN<32>` e permitir correlação com o off-chain.
