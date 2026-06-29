# 12 — Docker Compose Local

Objetivo: **subir tudo com um comando**, rodar migrations e testes, acessar API e frontend,
e conectar à **Stellar Testnet real** via variáveis de ambiente.

Arquivo: `infra/docker/docker-compose.local.yml`. Variáveis: `infra/docker/.env.local.example`.

## 1. Serviços

| Serviço | Função | Porta local |
|---------|--------|-------------|
| `postgres` | Banco PostgreSQL 16 | 5432 |
| `redis` | Filas/idempotência/rate limit/cache | 6379 |
| `migrate` | Roda migrations e sai (one-shot) | — |
| `api` | Backend NestJS | 3000 |
| `worker` | Jobs assíncronos (sync/expire/webhooks) | — |
| `web` | Frontend Next.js (público + admin) | 3001 |

> Soroban/Stellar **não** roda em container local: usa a **Testnet pública** (Horizon +
> Soroban RPC + Friendbot) via variáveis. Opcionalmente, suporte futuro a `stellar
> quickstart` local pode ser adicionado, mas o MVP usa a Testnet real.

## 2. Esboço do `docker-compose.local.yml`

```yaml
# Ilustrativo — versão final no repositório de implementação
name: payorder-local

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [ "payorder_pg:/var/lib/postgresql/data" ]
    ports: [ "5432:5432" ]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [ payorder ]

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [ "payorder_redis:/data" ]
    ports: [ "6379:6379" ]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [ payorder ]

  migrate:
    build: { context: ../../, dockerfile: infra/docker/api.Dockerfile }
    command: ["npm", "run", "db:migrate"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres: { condition: service_healthy }
    networks: [ payorder ]
    restart: "no"

  api:
    build: { context: ../../, dockerfile: infra/docker/api.Dockerfile }
    env_file: [ .env.local ]
    ports: [ "3000:3000" ]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks: [ payorder ]

  worker:
    build: { context: ../../, dockerfile: infra/docker/api.Dockerfile }
    command: ["npm", "run", "start:worker"]
    env_file: [ .env.local ]
    depends_on:
      api: { condition: service_started }
      redis: { condition: service_healthy }
    networks: [ payorder ]

  web:
    build: { context: ../../, dockerfile: infra/docker/web.Dockerfile }
    env_file: [ .env.local ]
    ports: [ "3001:3000" ]
    depends_on:
      api: { condition: service_started }
    networks: [ payorder ]

volumes:
  payorder_pg:
  payorder_redis:

networks:
  payorder:
    driver: bridge
```

## 3. `.env.local.example` (campos mínimos)

```dotenv
# Banco
POSTGRES_USER=payorder
POSTGRES_PASSWORD=payorder
POSTGRES_DB=payorder
DATABASE_URL=postgres://payorder:payorder@postgres:5432/payorder

# Redis
REDIS_URL=redis://redis:6379

# API
API_PORT=3000
APP_BASE_URL=http://localhost:3000
PUBLIC_WEB_URL=http://localhost:3001
JWT_SECRET=change-me-local
CORS_ORIGINS=http://localhost:3001

# Stellar (Testnet)
STELLAR_NETWORK=TESTNET
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_FRIENDBOT_URL=https://friendbot.stellar.org
SOROBAN_CONTRACT_ID=          # preenchido após deploy do contrato na Testnet
SOROBAN_ADMIN_SECRET=         # NUNCA commitar; conta admin do contrato (Testnet)

# Webhooks
WEBHOOK_SIGNING_SECRET=change-me-local

# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_EXPLORER_BASE=https://stellar.expert/explorer/testnet
```

## 4. Comandos (Makefile sugerido)

```bash
make up          # docker compose -f infra/docker/docker-compose.local.yml up -d --build
make down        # derruba e mantém volumes
make logs        # acompanha logs
make migrate     # roda migrations (serviço migrate)
make seed        # popula dados de exemplo (tenant + wallet)
make test        # roda suíte de testes no container api
make e2e         # roda Playwright contra api+web
```

## 5. O ambiente local permite

- Subir tudo com **um comando** (`make up`).
- Rodar **migrations** (`migrate`) e **testes** (`make test`).
- Acessar **frontend** em `http://localhost:3001` e **API** em `http://localhost:3000`.
- Simular **criação de tenant** e **cadastro de wallet no tenant**.
- Simular **criação de Payment Order informando apenas tenant + valor**.
- Conectar à **Stellar Testnet real** via variáveis (Horizon/Soroban RPC/Friendbot).

## 6. Healthchecks e ordem de subida

- `postgres`/`redis` expõem healthcheck; `migrate` espera Postgres saudável; `api` espera
  `migrate` concluído; `worker`/`web` esperam `api`.
- `/health` (liveness) e `/ready` (readiness — checa DB/Redis/RPC) descritos em `15`.
