# 06 — Gestão da Wallet Destino (no cadastro do tenant)

## 1. Princípio

A **wallet destino é uma propriedade do tenant**, armazenada **na tabela `tenants`**
(`stellar_wallet_public_key` + `stellar_network`). **Não há tabela `tenant_wallets`
obrigatória no MVP.** A cobrança **nunca** recebe wallet digitada manualmente — ela é
sempre resolvida a partir do tenant.

> Evolução futura: uma tabela `tenant_wallets` (1:N, histórico, múltiplas redes/assets)
> pode ser introduzida sem quebrar contratos, migrando o campo atual para "wallet
> principal". Para o MVP, **wallet principal = campo no tenant**.

## 2. Abordagens para a wallet destino

### Opção A — Wallet criada pelo produto (custodial)

O produto gera uma wallet Stellar Testnet no onboarding.

- **Geração:** `Keypair.random()` (ed25519) via `@stellar/stellar-sdk`; financiamento via
  **Friendbot** (Testnet) para ativar a conta.
- **Proteção da seed:** se a seed existir no backend, **nunca** em código/repos/logs.
  No MVP, se adotada, criptografar em repouso (ex.: AES-256-GCM com chave em variável de
  ambiente/secret manager) — **mas isto introduz custódia**.
- **Limitações/riscos:** o produto passa a ser **custodiante** de fundos do tenant →
  responsabilidade legal, superfície de ataque, ponto único de falha, complexidade de
  rotação/backup. Não recomendado para produção sem KMS/HSM.
- **Estratégia segura para MVP (se usada):** isolar em módulo dedicado, criptografar seed,
  segregar a chave de criptografia do banco, restringir acesso, auditar todo uso.
- **Evolução futura:** mover qualquer custódia para **Vault/KMS/HSM**, com assinatura
  delegada e nunca expor seed em texto claro.

### Opção B — Wallet informada pelo tenant (não custodial) ✅ **Recomendada**

O tenant informa uma public key Stellar Testnet **já existente**, que ele controla.

- **Validação:** strkey ed25519 válida (prefixo `G`, 56 chars, checksum); rede `TESTNET`;
  opcionalmente verificar existência/saldo da conta via Horizon.
- **Prova de posse (opcional, recomendada):** desafio de assinatura — o sistema gera um
  nonce, o tenant assina com sua wallet e o backend verifica a assinatura contra a public
  key. Garante que o tenant controla a chave (evita cadastrar wallet de terceiros).
- **Vantagens:** o produto **não custodia chaves**; menor superfície de risco; alinhado ao
  princípio não custodial; simples para o MVP.
- **Produção:** recomendada — o tenant mantém o controle da própria wallet.

## 3. Recomendação para o MVP

**Adotar a Opção B (wallet informada pelo tenant), não custodial**, com prova de posse
**opcional** no MVP e **recomendada** para produção.

Justificativa: maximiza segurança (sem custódia), minimiza complexidade e responsabilidade
legal, e mantém a evolução natural para Mainnet/produção. A Opção A fica disponível como
recurso opcional documentado, sempre marcando claramente os riscos de custódia e a
necessidade de Vault/KMS/HSM antes de produção.

> O sistema **nunca** custodia ou armazena a **seed do pagador** — isso é invariável
> independentemente da opção escolhida para a wallet do tenant.

## 4. Regras de alteração da wallet do tenant

- A wallet pode ser cadastrada/atualizada via `PUT /api/tenants/{id}/wallet`.
- **Bloqueio de troca com cobranças ativas (RN-09):** se existir ao menos uma
  `PaymentOrder` em status `ACTIVE` (ou `CREATED`) para o tenant, a alteração é **negada**
  (`409 WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS`). Isso evita inconsistência operacional.
- **Preservação histórica (RN-03):** independentemente da troca, cada `PaymentOrder` guarda
  sua própria `receiver_wallet_public_key` **copiada na criação** — ordens antigas nunca
  mudam de destino.
- Toda alteração gera evento `TenantWalletAssigned` + registro em `audit_logs`.

## 5. Resolução automática da wallet na criação da cobrança

```text
createPaymentOrder(input):
  tenant = resolveTenant(input.tenant_id | slug | document)
  assert tenant != null            -> 404 TENANT_NOT_FOUND
  assert tenant.status == ACTIVE   -> 409 TENANT_INACTIVE
  assert tenant.wallet != null     -> 409 TENANT_WALLET_NOT_SET
  receiver_wallet = tenant.stellar_wallet_public_key   # cópia imutável
  ... segue criação da ordem (payload canônico, hash, registro on-chain)
```

O cliente que tentar **informar wallet manualmente** no payload de criação recebe
`422 WALLET_NOT_ALLOWED_ON_ORDER` (campo proibido).

## 6. Erros esperados

| Situação | HTTP | Código |
|----------|------|--------|
| Public key inválida | 422 | `INVALID_STELLAR_PUBLIC_KEY` |
| Rede não suportada | 422 | `UNSUPPORTED_NETWORK` |
| Prova de posse falhou | 422 | `WALLET_OWNERSHIP_PROOF_FAILED` |
| Troca com ordens ativas | 409 | `WALLET_CHANGE_BLOCKED_ACTIVE_ORDERS` |
| Tenant sem wallet ao criar ordem | 409 | `TENANT_WALLET_NOT_SET` |
| Wallet informada na criação da ordem | 422 | `WALLET_NOT_ALLOWED_ON_ORDER` |

## 7. Testes (resumo)

- Vincular wallet válida (Opção B); rejeitar inválida/rede errada.
- Prova de posse: sucesso e falha.
- Bloquear troca de wallet com ordem ativa; permitir sem ordens ativas.
- Resolução automática da wallet por `tenant_id`, `slug` e `document`.
- Cobrança falha para tenant sem wallet / inativo.
- Ordem antiga mantém wallet mesmo após troca da wallet do tenant.
- (Opção A) geração + financiamento Friendbot; seed nunca em log.
