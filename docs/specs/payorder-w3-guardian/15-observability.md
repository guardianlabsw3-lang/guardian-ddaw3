# 15 — Observabilidade

## 1. Logs estruturados

- Formato **JSON** (pino) em todos os serviços (api, worker, web server-side).
- Campos padrão: `timestamp`, `level`, `service`, `correlation_id`, `request_id`,
  `tenant_id?`, `payment_order_id?`, `event?`, `msg`.
- **Sem dados sensíveis** (sem seeds, segredos, API keys; documento/e-mail mascarados).
- Níveis: `error`/`warn`/`info`/`debug`; produção em `info`.

## 2. Correlação e rastreabilidade

- `X-Request-Id` aceito ou gerado no ingresso; propagado por toda a chamada e para jobs do
  worker e webhooks.
- **Rastreável por:** `payment_order_id`, `external_id`, `tenant_id`, `receiver_wallet`
  (wallet destino) e `blockchain_transaction_hash`.
- Cada evento de domínio carrega `correlation_id` para ligar HTTP → fila → on-chain → webhook.

## 3. Logs específicos do domínio

- **Eventos on-chain:** registro/pagamento/cancelamento/expiração — log com `order_id`,
  `contract_id`, `tx_hash`, `ledger`, `status`.
- **Webhooks:** tentativa, status HTTP, latência, próxima retentativa, `delivery_id`.
- **Sincronização:** divergências on-chain/off-chain detectadas e reconciliadas.

## 4. Métricas básicas

Expostas em `/metrics` (Prometheus) — opcional no MVP, recomendado:
- `http_requests_total{route,status}` e latência (histograma).
- `payment_orders_created_total{source}`, `payment_orders_paid_total`.
- `soroban_register_total{status}`, `soroban_pay_observed_total`.
- `webhook_deliveries_total{status}`, `webhook_retry_total`.
- `queue_jobs_total{queue,status}`, profundidade de fila.
- `onchain_offchain_divergences_total`.

## 5. Health e readiness

| Endpoint | Verifica | Uso |
|----------|----------|-----|
| `GET /health` | Processo vivo (liveness). | Docker/Traefik/k8s. |
| `GET /ready` | DB, Redis e Soroban RPC acessíveis (readiness). | Roteamento só quando pronto. |

`/ready` retorna `200` apenas se dependências essenciais respondem; caso contrário `503`.

## 6. Trilha de auditoria

- `audit_logs` registra ações críticas (tenant/wallet/ordem/cancelamento/webhook resend)
  com ator, ação, `entity`, `correlation_id` e diff sanitizado.
- Consulta administrativa por entidade/ator/período.

## 7. Alertas (recomendado, pós-MVP)

- Taxa de erro HTTP > limiar; falhas de registro on-chain; webhooks esgotados;
  divergência on-chain/off-chain persistente; fila acumulando; `/ready` falhando.

## 8. Painéis (recomendado, pós-MVP)

- Visão de funil: ordens criadas → registradas → pagas.
- Saúde de integrações (webhooks, RPC Stellar).
- Latência de criação de ordem e de confirmação on-chain.
