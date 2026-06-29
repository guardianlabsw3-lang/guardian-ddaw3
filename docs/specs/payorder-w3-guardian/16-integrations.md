# 16 — Integrações e Origens de Cobrança

Toda cobrança, independentemente da origem, segue o **mesmo fluxo interno**: resolver
tenant → recuperar wallet do tenant → criar ordem → payload canônico → hash → registrar
on-chain → gerar link público. A origem é registrada em `source`/`metadata.source`.

## 1. Frontend público de pagamento

Tela pública acessada pelo `public_payment_slug`. Prioriza **poucos cliques** e é **não
custodial**.

### 1.1 Informações exibidas

- Nome do recebedor (tenant) e documento (quando aplicável).
- **Wallet destino Stellar Testnet** do tenant.
- Valor e asset.
- Vencimento e status.
- `order_id`, `canonical_payload_hash` e dados de verificação (contract id).
- **Aviso claro de ambiente Testnet.**
- Botão **Conectar wallet** e botão **Pagar**.
- Resultado da transação + **link para o explorer** da Stellar Testnet.

### 1.2 Fluxo (poucos cliques)

```text
1. Pagador abre o link.
2. Sistema mostra destino e valor.
3. Pagador conecta sua wallet (Stellar Wallets Kit / Freighter).
4. Sistema mostra confirmação (destino, valor, asset).
5. Pagador clica em Pagar.
6. A wallet assina a transação (no cliente).
7. O pagamento é realizado on-chain (pagador → wallet do tenant).
8. Sistema mostra status PAID e link do explorer.
```

### 1.3 Regras

- A wallet do pagador **assina no frontend**; a seed **nunca** vai ao backend.
- O frontend monta a invocação `pay(order_id, payer, amount, asset)` do contrato e submete
  via wallet conectada.
- Após sucesso, o backend (worker) observa o evento `paid` e sincroniza o status; a UI pode
  exibir "confirmando" até a conciliação.

## 2. Painel administrativo

Tela admin inicial para:
- listar tenants;
- cadastrar/editar wallet destino do tenant (respeitando regras de `06`);
- **criar cobrança manual** (UC-03);
- listar cobranças, consultar status, visualizar eventos de pagamento.

## 3. Criação manual de cobrança (painel)

Campos mínimos no formulário: **tenant destino**, **valor**, asset (opcional → padrão do
tenant), vencimento (opcional), descrição (opcional).

- **A wallet destino não é digitada.** Ao selecionar o tenant, o sistema **carrega
  automaticamente** a wallet cadastrada e a exibe somente para conferência (read-only).
- Ao confirmar, o sistema gera: **Payment Order ID**, **hash**, **registro no contrato
  Soroban**, **link público** e status `ACTIVE` (após confirmação on-chain).

## 4. Criação de cobrança via API

Endpoint `POST /api/payment-orders` (ver `08-api-contracts.md`). Autenticação por API key,
`Idempotency-Key` obrigatório. Resolve tenant por `tenant_id`/`slug`; mesmo fluxo do painel.

## 5. Exemplo de integração ERP (origem externa, **não obrigatória**)

O ERP é **apenas um exemplo** de origem. O produto **não depende** de ERP.

Payload exemplo:
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

Processamento:
1. Autenticar a API key do ERP (escopo `orders:create`).
2. Resolver tenant **pelo `tenant_document` (CNPJ)** → `404` se não encontrado.
3. Validar tenant `ACTIVE` e com wallet → `409` caso contrário.
4. Recuperar a wallet do tenant (cópia para a ordem).
5. Idempotência por `(tenant_id, external_id)` e `Idempotency-Key`.
6. Criar ordem, gerar hash, registrar on-chain, gerar link público.
7. Responder com a ordem + `public_payment_url`.
8. Em mudanças de status, enviar **webhook assinado** ao `callback_url` (com retries).

> O mesmo modelo serve a futuras origens (checkout, links de pagamento, propostas
> comerciais): basta uma origem que envie um identificador de tenant resolvível e o valor.

## 6. Webhooks de retorno

Ver `08-api-contracts.md §5`: eventos, assinatura HMAC, retries com backoff, reenvio
manual, idempotência do consumidor por `id` do evento.

## 7. Erros de integração (resumo)

| Situação | HTTP | Código |
|----------|------|--------|
| Sem autenticação | 401 | `UNAUTHENTICATED` |
| Escopo insuficiente | 403 | `FORBIDDEN_SCOPE` |
| CNPJ sem tenant | 404 | `TENANT_NOT_FOUND` |
| Tenant inativo | 409 | `TENANT_INACTIVE` |
| Tenant sem wallet | 409 | `TENANT_WALLET_NOT_SET` |
| Wallet informada manualmente | 422 | `WALLET_NOT_ALLOWED_ON_ORDER` |
| Ordem duplicada (external_id) | 200 | retorna ordem existente |
| Idempotency-Key conflitante | 409 | `IDEMPOTENCY_KEY_CONFLICT` |
