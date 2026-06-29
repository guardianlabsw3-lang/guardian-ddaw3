# 02 — Requisitos, Escopo, Personas e Casos de Uso

## 1. Escopo da MVP

A MVP entrega o fluxo completo **criar tenant → cadastrar wallet no tenant → criar
cobrança (só tenant + valor) → resolver wallet automaticamente → registrar on-chain →
pagar via link público não custodial → marcar PAID → sincronizar status**.

Incluído no MVP:

- Onboarding de tenant com wallet Stellar **Testnet** vinculada ao cadastro do tenant.
- Wallet destino **na tabela `tenants`** (sem tabela separada obrigatória).
- Criação de Payment Order por **painel admin** e por **API** (incluindo exemplo ERP).
- **Resolução automática da wallet** do tenant; bloqueio de cobrança para tenant sem
  wallet ou inativo.
- Payload **canônico** + **hash SHA-256** registrado no **contrato Soroban**.
- **Cópia da wallet destino** para a Payment Order na criação (preservação histórica).
- **Link público** de pagamento.
- **Frontend público não custodial** (conectar wallet, confirmar, pagar).
- **Painel admin** mínimo (tenants, wallet do tenant, cobranças, status, eventos).
- **Sincronização on-chain/off-chain** via worker.
- **Webhooks** para integrações externas (com retries e idempotência).
- **Auditoria**, **observabilidade** básica, **rate limiting**, **CORS**.
- Empacotamento **Docker local** e **Docker VPS com Traefik existente**.

## 2. Fora de escopo da MVP

- **Mainnet** (somente Testnet).
- Integração com **Boleto Guardian**.
- Custódia gerenciada de chaves via Vault/KMS/HSM (apenas recomendado para futuro).
- Multi-asset/multi-issuer simultâneos por tenant (MVP: 1 asset padrão; outros assets
  apenas declarados, não exigidos).
- Tabela `tenant_wallets` separada (apenas mencionada como evolução).
- RBAC granular multiusuário por tenant (MVP: admin global simples).
- Conciliação financeira avançada, relatórios, faturamento de fees.
- Notificações por e-mail/push ao pagador.
- Pagamentos parciais ou em múltiplas parcelas.

## 3. Personas

| Persona | Descrição | Necessidades principais |
|---------|-----------|-------------------------|
| **Admin Guardian Labs** | Opera o painel administrativo. | Cadastrar tenants e wallets, criar/cancelar cobranças, ver status e eventos. |
| **Tenant / Empresa recebedora** | Entidade que recebe pagamentos. | Ter sua wallet vinculada e receber pagamentos no destino correto. |
| **Sistema integrador (API/ERP)** | Outro sistema que origina cobranças. | Criar ordens de forma autenticada e idempotente; receber webhooks. |
| **Pagador** | Usuário final que paga a cobrança. | Verificar destino/valor; pagar em poucos cliques de forma não custodial. |
| **Desenvolvedor/SRE** | Implementa e opera a solução. | Rodar local com 1 comando; deploy seguro na VPS; observabilidade. |

## 4. Casos de uso

### UC-01 — Onboarding de tenant
Admin cadastra um tenant com nome, documento, e-mail e dados de asset padrão. A wallet
Testnet é **vinculada** (informada pelo tenant — abordagem recomendada) ou criada pelo
produto (opcional). Resultado: tenant `ACTIVE` com `stellar_wallet_public_key`.

### UC-02 — Cadastrar/atualizar wallet do tenant
Admin cadastra ou atualiza a wallet Stellar Testnet do tenant. Atualização é **bloqueada
se houver cobranças `ACTIVE`** (ver `06-wallet-management.md`).

### UC-03 — Criar cobrança manual (painel)
Admin seleciona tenant, informa valor (asset opcional → usa padrão do tenant), vencimento
e descrição opcionais. **Não digita wallet.** Sistema resolve wallet, gera ordem, hash,
registra on-chain e gera link público.

### UC-04 — Criar cobrança via API
Sistema integrador chama `POST /api/payment-orders` com `tenant_id` (+ idempotency key).
Mesmo fluxo do UC-03.

### UC-05 — Criar cobrança via ERP (exemplo)
ERP envia `tenant_document` (CNPJ), valor, `external_id`, `callback_url`. Backend resolve
tenant pelo documento, recupera wallet, cria ordem, registra on-chain e responde com link.
Posteriormente envia webhook ao `callback_url`.

### UC-06 — Pagar via link público
Pagador abre o link, vê destino/valor, conecta wallet Testnet, confirma e paga. A wallet
assina no frontend; o pagamento ocorre on-chain; contrato marca `PAID`.

### UC-07 — Consultar status
Admin/integrador consulta status on-chain/off-chain por id, slug público, `external_id` ou
`tenant_id`.

### UC-08 — Cancelar cobrança
Admin (autoridade autorizada) cancela uma ordem `ACTIVE`. Contrato transita para
`CANCELLED`. Pagamento passa a ser impedido.

### UC-09 — Expirar cobrança
Worker detecta `due_date` vencida em ordens `ACTIVE` e transita para `EXPIRED`
(off-chain + on-chain).

### UC-10 — Reenviar webhook
Admin/integrador solicita reenvio de webhook de uma ordem.

## 5. Requisitos funcionais (RF)

| ID | Requisito |
|----|-----------|
| RF-01 | Criar, consultar, listar e ativar/inativar tenants. |
| RF-02 | Cadastrar/atualizar/consultar a wallet Stellar Testnet do tenant (na tabela `tenants`). |
| RF-03 | Validar formato da public key Stellar (ed25519, prefixo `G`, 56 chars, checksum). |
| RF-04 | Criar Payment Order por painel, API e integração externa, com **fluxo único**. |
| RF-05 | Resolver tenant por `tenant_id`, `slug` ou `document_number` (CNPJ). |
| RF-06 | Recuperar automaticamente a wallet do tenant; **proibir** wallet manual na cobrança. |
| RF-07 | **Impedir** criação de cobrança para tenant inativo ou sem wallet. |
| RF-08 | Gerar **payload canônico** determinístico e calcular **hash SHA-256**. |
| RF-09 | **Copiar** `receiver_wallet_public_key` do tenant para a ordem na criação. |
| RF-10 | Persistir ordem em PostgreSQL com status inicial e timestamps. |
| RF-11 | Registrar a ordem no **contrato Soroban** (ou preparar invocação assíncrona). |
| RF-12 | Gerar **link público** (`public_payment_slug`) único e não sequencial. |
| RF-13 | Expor **consulta pública** da ordem (dados não sensíveis). |
| RF-14 | Expor **APIs administrativas** autenticadas. |
| RF-15 | **Sincronizar status** on-chain/off-chain via worker. |
| RF-16 | Garantir **idempotência** por `Idempotency-Key` e por `(tenant_id, external_id)`. |
| RF-17 | Registrar **trilha de auditoria** de eventos críticos. |
| RF-18 | Enviar **webhooks** com assinatura, retries e backoff; permitir reenvio. |
| RF-19 | Frontend público **não custodial**: assinatura da transação no cliente. |
| RF-20 | **Nunca** armazenar a seed privada da wallet do pagador. |
| RF-21 | Cancelar ordem `ACTIVE` apenas por autoridade autorizada. |
| RF-22 | Expirar ordens `ACTIVE` vencidas. |
| RF-23 | Validar duplicidade de ordem on-chain e off-chain. |
| RF-24 | Disponibilizar eventos da ordem (`payment_order_events`) para consulta. |

## 6. Requisitos não funcionais (RNF)

| ID | Requisito | Meta MVP |
|----|-----------|----------|
| RNF-01 | **Segurança por design** | Sem secrets em código; `.env.example`; validação forte; rate limiting; CORS; sem dados sensíveis em log. |
| RNF-02 | **Não custódia do pagador** | Seed do pagador nunca trafega/persiste no backend. |
| RNF-03 | **Idempotência** | Operações de criação idempotentes; replay protegido. |
| RNF-04 | **Resiliência** | Retries com backoff em chamadas Stellar e webhooks; jobs reprocessáveis. |
| RNF-05 | **Observabilidade** | Logs estruturados com `correlation_id`; `/health` e `/ready`; métricas básicas. |
| RNF-06 | **Testabilidade** | Cobertura mínima: domínio ≥ 90%, contrato Soroban ≥ 85%, geral ≥ 80%. |
| RNF-07 | **Performance** | Criação de ordem (excl. confirmação on-chain) p95 < 800 ms. |
| RNF-08 | **Portabilidade** | Subir tudo localmente com 1 comando (Docker Compose). |
| RNF-09 | **Deploy seguro em VPS** | Não quebrar Traefik existente; rede externa; sem expor portas. |
| RNF-10 | **Manutenibilidade** | Clean Code, SOLID, módulos pequenos com responsabilidade única. |
| RNF-11 | **Auditabilidade** | Rastreabilidade por `payment_order_id`, `external_id`, `tenant_id`, wallet, `transaction_hash`. |
| RNF-12 | **Compatibilidade de ambiente** | Operação restrita à Testnet; chaves separadas por ambiente. |

## 7. Regras de negócio chave (invariantes)

- **RN-01** Cobrança só pode ser criada para tenant `ACTIVE` com wallet válida.
- **RN-02** A wallet destino **não** é informada na criação da cobrança; é derivada do tenant.
- **RN-03** A `receiver_wallet_public_key` da ordem é **imutável** após a criação.
- **RN-04** `amount`, `asset_code`/`asset_issuer` e o `canonical_payload_hash` são imutáveis após registro on-chain.
- **RN-05** Pagamento só é permitido quando a ordem está `ACTIVE` (on-chain) e dentro da validade.
- **RN-06** Pagamento exige valor e asset **exatamente iguais** aos registrados.
- **RN-07** Não há pagamento duplicado; não se paga ordem `PAID`/`CANCELLED`/`EXPIRED`/`FAILED`.
- **RN-08** Cancelamento só por autoridade autorizada e apenas sobre ordem `ACTIVE`.
- **RN-09** A wallet do tenant não pode ser alterada enquanto existirem cobranças `ACTIVE` (ordens já criadas preservam a wallet copiada de qualquer forma).
