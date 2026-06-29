# 10 — Estratégia de Segurança

Segurança **desde o design**. Esta seção consolida controles obrigatórios do MVP.

## 1. Segredos e configuração

- **Nenhum segredo em código ou repositório.** Apenas `*.env.example` versionados, sem
  valores reais.
- Variáveis reais **só em ambiente** (Docker secrets / variáveis da VPS / secret manager).
- **Separação de chaves por ambiente** (local, CI, VPS). Chave admin do contrato Soroban,
  segredos de webhook e credenciais de banco são distintos por ambiente.
- **Testnet isolada:** nenhuma configuração de Mainnet é aceita no MVP (validação rejeita
  `stellar_network != TESTNET`).

## 2. Não custódia do pagador (invariante)

- A **seed/secret da wallet do pagador NUNCA** trafega pelo backend nem é persistida.
- A transação de pagamento é **montada e assinada no frontend** pela wallet do pagador
  (Stellar Wallets Kit / Freighter etc.).
- O backend apenas **observa** o resultado on-chain e concilia status.

## 3. Custódia da wallet do tenant

- **Recomendado:** modelo **não custodial** (Opção B em `06-wallet-management.md`) — o
  tenant informa sua própria public key; o produto não guarda seed.
- Se a Opção A (produto cria wallet) for usada no MVP: seed **criptografada em repouso**,
  chave de criptografia segregada do banco, acesso auditado, **nunca** em logs. Marcar
  claramente como custódia e migrar para **Vault/KMS/HSM** antes de produção.
- A **chave admin do contrato** (que assina `register_order`/`cancel`) é um segredo crítico:
  guardada fora do código, idealmente em secret manager; rotação documentada.

## 4. Entrada e validação

- **Validação forte** de toda entrada com schemas zod compartilhados.
- Rejeição explícita de **wallet manual na criação de ordem** (`WALLET_NOT_ALLOWED_ON_ORDER`).
- Validação de strkey, asset, valor (decimal positivo, escala ≤ 7), datas.
- Limites de tamanho para `metadata`, `description`, `external_id`.

## 5. Proteções de transporte e acesso

- **HTTPS** obrigatório (terminação no Traefik na VPS).
- **CORS** configurado por allowlist de origens (painel e domínio público); sem `*` em
  produção.
- **Rate limiting** por API key e por IP (ex.: criação de ordens, consulta pública,
  login admin); resposta `429` com `Retry-After`.
- **Headers de segurança:** HSTS, `X-Content-Type-Options`, `X-Frame-Options`/CSP no front.
- **Autenticação:** admin via JWT/sessão (senha argon2id); integradores via API key com
  escopos e tenants permitidos. Princípio do menor privilégio.

## 6. Idempotência e anti-replay

- `Idempotency-Key` obrigatório na criação de ordens; respostas memorizadas (ver `09`/`08`).
- `(tenant_id, external_id)` único evita duplicidade de cobrança.
- **Webhooks assinados (HMAC)** com timestamp e janela de tolerância → o consumidor rejeita
  replays.
- Nonce + assinatura na **prova de posse** da wallet do tenant (quando habilitada).

## 7. Logs e dados sensíveis

- **Logs estruturados sem dados sensíveis** (sem seeds, sem segredos, sem PII além do
  necessário). Mascarar documento/e-mail quando logado.
- `correlation_id`/`request_id` em todos os logs para rastreabilidade.
- Erros retornados ao cliente **não vazam** detalhes internos (stack, SQL, segredos).

## 8. Autorização de operações críticas

- **Criação/cancelamento** de ordens exige permissão (admin ou API key com escopo).
- **Cancelamento** no contrato só por **autoridade autorizada** (admin do contrato).
- **Alteração da wallet do tenant** bloqueada com ordens ativas (`06`).

## 9. Integridade da cobrança

- **Hash canônico** registrado on-chain; a tela pública e a consulta expõem o hash para
  verificação independente.
- `receiver_wallet_public_key`, `amount`, `asset` e `canonical_payload_hash` **imutáveis**
  após criação/registro (no banco e no contrato).
- **Cópia da wallet destino** para a ordem preserva o histórico mesmo após troca da wallet
  do tenant.

## 10. Trilha de auditoria

- Eventos críticos (criação/alteração de tenant e wallet, criação/cancelamento de ordem,
  pagamentos, reenvio de webhook) registrados em `audit_logs` com ator, ação e diff
  sanitizado.

## 11. Dependências e supply chain

- Lockfiles fixados; varredura de vulnerabilidades (npm audit / `cargo audit`) no CI.
- Imagens base mínimas e atualizadas; usuário não-root nos containers.
- `secret scanning` no CI para impedir commit de segredos.

## 12. Checklist de segurança (gate de release)

- [ ] Sem segredos no repositório; `.env.example` completos.
- [ ] Testnet forçada; Mainnet bloqueada.
- [ ] Seed do pagador nunca no backend (revisado no fluxo de pagamento).
- [ ] Wallet manual na ordem rejeitada.
- [ ] Rate limiting + CORS + HTTPS ativos.
- [ ] Idempotência e webhooks assinados.
- [ ] Logs sem dados sensíveis; auditoria ativa.
- [ ] Imagens não-root; varredura de dependências verde.
