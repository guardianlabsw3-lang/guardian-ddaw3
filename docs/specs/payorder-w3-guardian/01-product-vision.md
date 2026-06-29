# 01 — Visão de Produto

## 1. Visão de negócio

O PayOrder W3 Guardian é um **rail de cobrança Web3** da Guardian Labs. Ele recebe
cobranças de **múltiplas origens** (painel, API, ERP, integrações futuras) e as converte
em **ordens de pagamento verificáveis on-chain**, pagas diretamente entre wallets Stellar.

### 1.1 Proposta de valor

- **Para o recebedor (tenant):** receber pagamentos Web3 sem expor manualmente sua wallet
  em cada cobrança, com destino sempre correto e registro auditável.
- **Para o pagador:** confiança total no destino antes de pagar; experiência de poucos
  cliques; prova pública on-chain.
- **Para a Guardian Labs:** um componente de cobrança reutilizável que pode ser plugado em
  outros produtos (checkout, links de pagamento, propostas comerciais), sem acoplamento a
  um produto específico.

### 1.2 Origens de cobrança suportadas

O produto é **agnóstico à origem**. Toda cobrança nasce de uma das origens abaixo, mas
segue o **mesmo fluxo interno** de resolução de tenant → wallet → ordem → registro on-chain:

- Criação manual pelo **painel administrativo**.
- **API interna** (outros sistemas Guardian Labs).
- Integração com **ERP** (exemplo de origem externa).
- Integrações futuras: **checkout, links de pagamento, propostas comerciais**, etc.

> O campo `metadata.source` (ou `source`) identifica a origem para fins de auditoria e
> rastreabilidade.

### 1.3 Modelo de monetização (fora do escopo técnico do MVP)

Embora não implementado no MVP, o desenho mantém espaço para evolução: fee por ordem,
plano por tenant, ou taxa sobre volume. O MVP **não** cobra fees on-chain além do custo de
rede da Stellar.

## 2. Visão técnica

### 2.1 Pilares

1. **Backend API** (NestJS) — orquestra tenants, ordens, resolução de wallet, payload
   canônico, hash, registro on-chain e webhooks.
2. **Frontend Web** (Next.js) — tela pública de pagamento (não custodial) + painel admin.
3. **Smart Contract Soroban** (Rust) — registro e ciclo de vida da Payment Order on-chain.
4. **Worker** — jobs assíncronos: sincronização on-chain/off-chain, expiração de ordens,
   entrega/retry de webhooks.
5. **PostgreSQL** — fonte de verdade off-chain.
6. **Redis** (opcional, recomendado) — filas, idempotência, rate limiting, cache.

### 2.2 Princípios de arquitetura

- **Clean Architecture + Hexagonal (Ports & Adapters)**: domínio no centro, isolado de
  frameworks; dependências apontam para dentro.
- **DDD simples**: agregados `Tenant` e `PaymentOrder`, value objects, sem excesso.
- **Baixo acoplamento** entre backend, frontend e contrato Soroban — comunicação por
  contratos bem definidos (OpenAPI, interface do contrato, tipos compartilhados).
- **Testabilidade desde o início**: domínio puro testável sem I/O.
- **Idempotência e resiliência** em toda operação que toca a rede ou cria recursos.

### 2.3 Fluxo on-chain / off-chain

```text
Origem (painel/API/ERP)
   │
   ▼
Backend API ── resolve tenant ── recupera wallet do tenant
   │                                   │
   │            ┌──────────────────────┘
   ▼            ▼
Payment Order (PostgreSQL)  ──> payload canônico ──> hash SHA-256
   │
   ├──> registra ordem no contrato Soroban (id, hash, tenant, wallet, valor, asset, ACTIVE)
   │
   ▼
Link público de pagamento
   │
   ▼
Pagador (frontend não custodial) ── conecta wallet ── confirma ── assina ── paga
   │
   ▼
Transferência on-chain (wallet pagador → wallet tenant)
   │
   ▼
Contrato marca PAID ──> Worker sincroniza status off-chain ──> webhooks/consultas
```

### 2.4 Fonte de verdade

- **Estado canônico do pagamento**: o **contrato Soroban** é a autoridade sobre o status
  on-chain (`ACTIVE`/`PAID`/`CANCELLED`/`EXPIRED`/`FAILED`).
- **PostgreSQL** é a fonte de verdade operacional/off-chain e mantém o status sincronizado
  para consultas rápidas, listagens e integrações.
- O **Worker** concilia ambos. Em divergência, o on-chain prevalece para o status de
  pagamento.

## 3. Diferenciais

- Wallet destino **derivada do tenant**, nunca digitada na cobrança.
- **Hash canônico on-chain** como prova de integridade.
- Pagamento **não custodial** para o pagador.
- **Multi-origem** com fluxo único.
- **Pronto para VPS com Traefik existente** sem quebrar o ambiente atual.

## 4. Evolução futura (não-MVP)

- Mainnet.
- Múltiplos assets e issuers por tenant.
- Custódia gerenciada via Vault/KMS/HSM (se o produto criar wallets).
- Múltiplos usuários admin por tenant, RBAC granular.
- Integração com checkout, links de pagamento e propostas comerciais.
- Notificações (e-mail/push) e reconciliação financeira avançada.
