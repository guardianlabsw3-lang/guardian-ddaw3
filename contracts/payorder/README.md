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
| `register_order(order_id, data_hash, tenant_ref, receiver, token, amount, asset, due_ledger)` | admin | Cria ordem `ACTIVE`. |
| `get_order(order_id)` | público | Consulta a ordem. |
| `pay(order_id, payer, amount, asset)` | payer | Paga e marca `PAID`. |
| `cancel_order(order_id)` | admin | `ACTIVE → CANCELLED`. |
| `expire_order(order_id)` | admin/qualquer (se vencido) | `ACTIVE → EXPIRED`. |
| `mark_failed(order_id, reason)` | admin | `ACTIVE → FAILED`. |

## Imutabilidade

Não há método para alterar `receiver`, `amount`, `asset` ou `data_hash` após
`register_order` — garantia de integridade por design.

## Resolução de asset (`token`)

O `AssetInfo` (`code` + `issuer`) identifica o asset para o registro canônico e para a
validação em `pay`. Para **mover fundos**, `pay` precisa do endereço do _Stellar Asset
Contract_ (SAC) do asset. Resolver o SAC a partir de `code`/`issuer` _on-chain_ é custoso e
frágil, então o backend resolve esse endereço de forma determinística e o passa como `token`
ao `register_order`; ele é armazenado (imutável) junto à ordem. O native XLM SAC pode ser
obtido com `stellar contract id asset --asset native --network testnet`.

## Build, teste e deploy (Testnet)

Requer Rust **1.84+** (target `wasm32v1-none`, exigido pelo `soroban-sdk` 26) e a
[Stellar CLI](https://developers.stellar.org/docs/tools/cli).

```bash
cd contracts/payorder

# Testes unitários (test harness do soroban-sdk) — não precisa de rede
cargo test

# Build do WASM
rustup target add wasm32v1-none
cargo build --target wasm32v1-none --release
# => target/wasm32v1-none/release/payorder.wasm
```

### Deploy automatizado

O script idempotente cobre todo o fluxo (tooling → build → deploy → `initialize` → smoke
`get_order`). A conta admin (segredo) **nunca** vai para o repositório:

```bash
# usa/gera a identidade 'payorder-admin' (financiada via Friendbot) por padrão
infra/scripts/deploy-contract.sh

# ou com um segredo administrativo já existente
SOROBAN_ADMIN_SECRET=S...  infra/scripts/deploy-contract.sh
```

O script grava o resultado em `contracts/payorder/deployments/testnet.json` e imprime o
`CONTRACT_ID`.

### Deploy manual (equivalente)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/payorder.wasm \
  --network testnet --source <ADMIN_KEY>

stellar contract invoke --id <CONTRACT_ID> --network testnet --source <ADMIN_KEY> \
  -- initialize --admin <ADMIN_PUBKEY>
```

Após o deploy, registre o `CONTRACT_ID` em `SOROBAN_CONTRACT_ID` no ambiente do backend e na
seção **Deployments** abaixo.

## Deployments

| Rede | `CONTRACT_ID` | Admin | Data |
|------|---------------|-------|------|
| Testnet | _(preencher após `infra/scripts/deploy-contract.sh`)_ | — | — |

> O deploy on-chain depende de acesso à Stellar Testnet (RPC + Friendbot) e da conta admin,
> portanto é executado pelo operador/CI com os segredos do ambiente — não a partir deste
> repositório. O contrato, os testes (`cargo test`) e o build do WASM já estão validados.

## Integração com o backend

- O backend chama `register_order` (assinado pela conta admin) e observa eventos.
- O **pagamento** (`pay`) é assinado **no frontend** pela wallet do pagador (não custodial).
- `order_id`/`tenant_ref` são derivados de forma determinística (32 bytes) para correlação
  com o off-chain.

## Versionamento

Cada `PaymentOrder` off-chain guarda seu `soroban_contract_id`. Upgrades publicam um novo
contrato para novas ordens; ordens antigas permanecem no contrato original.
