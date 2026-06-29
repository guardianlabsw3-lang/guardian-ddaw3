# Contrato Soroban — PayOrder

Smart contract em **Rust** (`soroban-sdk`) que registra e governa o ciclo de vida da
Payment Order na **Stellar Testnet**. É a **autoridade do status de pagamento** on-chain.

> Esta é a documentação do contrato. A especificação detalhada (estruturas, métodos,
> estados, erros e testes) está em
> [`docs/specs/payorder-w3-guardian/07-smart-contract.md`](../../docs/specs/payorder-w3-guardian/07-smart-contract.md).

## Responsabilidades

- Registrar a ordem (id, hash canônico, tenant, **wallet destino**, valor, asset, status).
- Evitar duplicidade de ordem.
- Permitir pagamento **apenas quando `ACTIVE`**, com valor e asset corretos e dentro da validade.
- Marcar `PAID`; impedir pagamento duplicado.
- Cancelar/expirar/marcar como falha conforme autorização.
- Consulta pública e emissão de eventos.

## Estados

`ACTIVE → PAID | EXPIRED | CANCELLED | FAILED` (terminais exceto `ACTIVE`).
On-chain a ordem nasce `ACTIVE` via `register_order` (o estado `CREATED` é off-chain).

## Métodos públicos (resumo)

| Método | Autoriza | Efeito |
|--------|----------|--------|
| `initialize(admin)` | deployer | Define a autoridade administrativa. |
| `register_order(order_id, data_hash, tenant_ref, receiver, amount, asset, due_ledger)` | admin | Cria ordem `ACTIVE`. |
| `get_order(order_id)` | público | Consulta a ordem. |
| `pay(order_id, payer, amount, asset)` | payer | Paga e marca `PAID`. |
| `cancel_order(order_id)` | admin | `ACTIVE → CANCELLED`. |
| `expire_order(order_id)` | admin/qualquer (se vencido) | `ACTIVE → EXPIRED`. |
| `mark_failed(order_id, reason)` | admin | `ACTIVE → FAILED`. |

## Imutabilidade

Não há método para alterar `receiver`, `amount`, `asset` ou `data_hash` após
`register_order` — garantia de integridade por design.

## Build, teste e deploy (Testnet)

```bash
# Build do WASM
cargo build --target wasm32-unknown-unknown --release

# Testes unitários (test harness do soroban-sdk)
cargo test

# Deploy na Testnet (conta admin fora do repositório)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payorder.wasm \
  --network testnet --source <ADMIN_KEY>

# Inicializar a autoridade administrativa
stellar contract invoke --id <CONTRACT_ID> --network testnet --source <ADMIN_KEY> \
  -- initialize --admin <ADMIN_PUBKEY>
```

Após o deploy, registre o `CONTRACT_ID` em `SOROBAN_CONTRACT_ID` no ambiente do backend.

## Integração com o backend

- O backend chama `register_order` (assinado pela conta admin) e observa eventos.
- O **pagamento** (`pay`) é assinado **no frontend** pela wallet do pagador (não custodial).
- `order_id`/`tenant_ref` são derivados de forma determinística (32 bytes) para correlação
  com o off-chain.

## Versionamento

Cada `PaymentOrder` off-chain guarda seu `soroban_contract_id`. Upgrades publicam um novo
contrato para novas ordens; ordens antigas permanecem no contrato original.
