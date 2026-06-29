# 13 — Docker Compose para VPS com Traefik existente

A Guardian Labs **já possui uma VPS com Traefik** em uso por outro produto. O deploy do
PayOrder **não pode quebrar** esse ambiente. A estratégia: **reusar a rede externa do
Traefik**, isolar nomes/volumes/project, **não expor portas** e configurar roteamento por
**labels**.

Arquivo: `infra/docker/docker-compose.vps.yml`. Variáveis: `infra/docker/.env.vps.example`.

## 1. Princípios de coexistência

- **Project name isolado:** `name: payorder` (evita colisão de containers/redes/volumes com
  o produto existente).
- **Rede externa do Traefik:** os serviços web/API entram na rede externa já usada pelo
  Traefik (ex.: `traefik_proxy`), declarada como `external: true`. Uma rede **interna
  privada** (`payorder_internal`) liga API/worker/banco/redis.
- **Sem `ports:`** nos serviços atrás do Traefik — o roteamento é via labels; nada é
  publicado diretamente no host.
- **Nomes de container e volumes prefixados** (`payorder_*`).
- **Banco isolado** por padrão (ver §4).

## 2. Esboço do `docker-compose.vps.yml`

```yaml
# Ilustrativo — versão final no repositório de implementação
name: payorder

services:
  api:
    image: ${REGISTRY}/payorder-api:${IMAGE_TAG}
    container_name: payorder_api
    env_file: [ .env.vps ]
    restart: unless-stopped
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    networks: [ traefik_proxy, payorder_internal ]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK}"
      - "traefik.http.routers.payorder-api.rule=Host(`${API_DOMAIN}`)"
      - "traefik.http.routers.payorder-api.entrypoints=websecure"
      - "traefik.http.routers.payorder-api.tls=true"
      - "traefik.http.routers.payorder-api.tls.certresolver=${CERT_RESOLVER}"
      - "traefik.http.services.payorder-api.loadbalancer.server.port=3000"

  worker:
    image: ${REGISTRY}/payorder-api:${IMAGE_TAG}
    container_name: payorder_worker
    command: ["npm", "run", "start:worker"]
    env_file: [ .env.vps ]
    restart: unless-stopped
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }
    networks: [ payorder_internal ]   # sem Traefik; não exposto

  web:
    image: ${REGISTRY}/payorder-web:${IMAGE_TAG}
    container_name: payorder_web
    env_file: [ .env.vps ]
    restart: unless-stopped
    depends_on:
      api: { condition: service_started }
    networks: [ traefik_proxy ]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK}"
      - "traefik.http.routers.payorder-web.rule=Host(`${WEB_DOMAIN}`)"
      - "traefik.http.routers.payorder-web.entrypoints=websecure"
      - "traefik.http.routers.payorder-web.tls=true"
      - "traefik.http.routers.payorder-web.tls.certresolver=${CERT_RESOLVER}"
      - "traefik.http.services.payorder-web.loadbalancer.server.port=3000"

  postgres:
    image: postgres:16-alpine
    container_name: payorder_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [ "payorder_pg:/var/lib/postgresql/data" ]
    restart: unless-stopped
    networks: [ payorder_internal ]   # nunca exposto ao Traefik/host
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: payorder_redis
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [ "payorder_redis:/data" ]
    restart: unless-stopped
    networks: [ payorder_internal ]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  migrate:
    image: ${REGISTRY}/payorder-api:${IMAGE_TAG}
    container_name: payorder_migrate
    command: ["npm", "run", "db:migrate"]
    env_file: [ .env.vps ]
    depends_on:
      postgres: { condition: service_healthy }
    networks: [ payorder_internal ]
    restart: "no"

volumes:
  payorder_pg:
  payorder_redis:

networks:
  traefik_proxy:
    external: true
    name: ${TRAEFIK_NETWORK}
  payorder_internal:
    driver: bridge
```

## 3. `.env.vps.example`

```dotenv
# Imagens / registry
REGISTRY=registry.example.com/guardianlabs
IMAGE_TAG=latest

# Traefik existente
TRAEFIK_NETWORK=traefik_proxy
CERT_RESOLVER=letsencrypt
WEB_DOMAIN=payorder.guardianlabs.com.br
API_DOMAIN=api-payorder.guardianlabs.com.br

# Banco (isolado)
POSTGRES_USER=payorder
POSTGRES_PASSWORD=__set_in_env__
POSTGRES_DB=payorder
DATABASE_URL=postgres://payorder:__set_in_env__@payorder_postgres:5432/payorder

# Redis
REDIS_URL=redis://payorder_redis:6379

# App
APP_BASE_URL=https://api-payorder.guardianlabs.com.br
PUBLIC_WEB_URL=https://payorder.guardianlabs.com.br
JWT_SECRET=__set_in_env__
CORS_ORIGINS=https://payorder.guardianlabs.com.br

# Stellar Testnet
STELLAR_NETWORK=TESTNET
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ID=__set_after_deploy__
SOROBAN_ADMIN_SECRET=__set_in_env__

# Webhooks
WEBHOOK_SIGNING_SECRET=__set_in_env__

# Frontend
NEXT_PUBLIC_API_BASE_URL=https://api-payorder.guardianlabs.com.br
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_EXPLORER_BASE=https://stellar.expert/explorer/testnet
```

> Domínios são **exemplos**; sempre via variável. Não assumir como finais.

## 4. Banco: isolado vs compartilhado

| Opção | Prós | Contras |
|-------|------|---------|
| **PostgreSQL isolado** (recomendado MVP) | Sem acoplamento ao produto existente; falhas/migrações isoladas; segurança por menor privilégio. | Mais um container/volume para operar e backupear. |
| **Reusar PostgreSQL existente** (schema/DB próprio) | Menos infraestrutura; backup centralizado. | Risco de impacto no produto existente; acoplamento operacional; cuidado com versões/locks/recursos. |

Recomendação: **banco isolado** no MVP. Se reusar o existente, criar **database/role
dedicados** com privilégios restritos e schema próprio, documentando o risco.

## 5. Regras de deploy seguro (não quebrar o existente)

- Confirmar o **nome real da rede do Traefik** (`docker network ls`) e usar em `TRAEFIK_NETWORK`.
- **Não** redefinir middlewares globais nem `entrypoints` do Traefik existente; usar apenas
  routers/labels **prefixados** (`payorder-*`).
- **Não publicar portas** (`ports:`) em serviços atrás do Traefik.
- Garantir **nomes de container, volumes e project** únicos (prefixo `payorder`).
- Validar com `docker compose -p payorder -f docker-compose.vps.yml config` antes de subir.
- Subir com `-p payorder` para isolar o projeto.
- **restart: unless-stopped** em serviços de longa duração; `migrate` é one-shot.
- Healthchecks habilitados; Traefik só roteia para containers saudáveis.

## 6. Procedimento de deploy

```bash
# Na VPS
docker compose -p payorder -f infra/docker/docker-compose.vps.yml pull
docker compose -p payorder -f infra/docker/docker-compose.vps.yml run --rm migrate
docker compose -p payorder -f infra/docker/docker-compose.vps.yml up -d
docker compose -p payorder -f infra/docker/docker-compose.vps.yml ps
```

## 7. Logs

- Driver de log padrão do Docker com rotação (`max-size`, `max-file`) por serviço.
- Logs estruturados (JSON) da aplicação (ver `15-observability.md`).
