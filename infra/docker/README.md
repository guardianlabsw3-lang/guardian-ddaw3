# Infraestrutura Docker — PayOrder W3 Guardian

Empacotamento e orquestração local e em VPS (com Traefik existente). Specs detalhadas:
- Local: [`docs/specs/payorder-w3-guardian/12-docker-local.md`](../../docs/specs/payorder-w3-guardian/12-docker-local.md)
- VPS/Traefik: [`docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md`](../../docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md)
- Deploy: [`docs/specs/payorder-w3-guardian/14-deployment.md`](../../docs/specs/payorder-w3-guardian/14-deployment.md)

## Arquivos

```text
infra/
  docker/
    api.Dockerfile            # imagem Node única: api · worker · migrate · seed (por comando)
    web.Dockerfile            # imagem do frontend (Next.js, output standalone)
    docker-compose.local.yml  # ambiente local completo
    docker-compose.vps.yml    # deploy na VPS (Traefik com provider Docker + labels)
    docker-compose.traefik.yml # deploy na VPS com o Traefik EXISTENTE (provider de ARQUIVO)
    .env.local.example        # variáveis locais
    .env.vps.example          # variáveis da VPS
  traefik/
    README.md                 # como integrar com o Traefik existente (labels, rede externa)
  scripts/
    deploy-contract.sh        # build + deploy do contrato Soroban (Testnet)
    deploy.sh                 # deploy da stack na VPS (pull → migrate → up → smoke)
```

> **Uma imagem Node, vários comandos.** `api.Dockerfile` empacota api, worker, migrate e seed.
> O comando selecionado decide o papel:
> `node apps/api/dist/main.js` (api, default) · `node apps/worker/dist/index.js` (worker) ·
> `node apps/api/dist/infrastructure/persistence/migrate.js` (migrate) ·
> `node apps/api/dist/infrastructure/persistence/seed.js` (seed).
>
> **Frontend.** As variáveis `NEXT_PUBLIC_*` são *inlined* no build do Next, então são passadas
> como **build args** (por ambiente): localmente via `docker-compose.local.yml`, no release via
> CI. Não são lidas em runtime.

## Local (resumo)

Serviços: `postgres`, `redis`, `migrate` (one-shot), `seed` (one-shot), `api`, `worker`, `web`.
Stellar usa a **Testnet pública** (Horizon/Soroban RPC/Friendbot) via variáveis.

```bash
make up        # sobe tudo (migra e popula o admin + tenant de exemplo automaticamente)
make migrate   # roda migrations
make seed      # re-popula admin + tenant + wallet de exemplo (idempotente)
make test      # suíte de testes
```

API em `http://localhost:3000`, Web em `http://localhost:3001`.

> **Primeiro login.** `make up` roda o `seed` (one-shot, após as migrations) antes de a API
> subir, então o usuário admin já existe na primeira tentativa de login. Credenciais locais em
> `.env.local` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

## VPS com Traefik (resumo)

- **Project name isolado** (`-p payorder`) e nomes/volumes prefixados (`payorder_*`).
- **Rede externa** do Traefik (`external: true`) para `api`/`web`; rede interna privada para
  `postgres`/`redis`/`worker`.
- **Sem `ports:`** em serviços atrás do Traefik; roteamento por **labels**.
- **Banco isolado** por padrão (ver trade-offs na spec).
- Domínios via variável (`WEB_DOMAIN`, `API_DOMAIN`); TLS via Traefik existente.

```bash
docker compose -p payorder -f infra/docker/docker-compose.vps.yml config   # valida
docker compose -p payorder -f infra/docker/docker-compose.vps.yml run --rm migrate
docker compose -p payorder -f infra/docker/docker-compose.vps.yml up -d
```

### Qual arquivo usar?

Depende de como o Traefik da VPS está configurado:

- **`docker-compose.vps.yml`** — Traefik com o **provider Docker habilitado**. O roteamento
  vem das **labels** `traefik.*` nos serviços.
- **`docker-compose.traefik.yml`** — Traefik com o **provider de ARQUIVO/diretório** e o provider
  Docker **desabilitado** (incompatível com Docker Engine 29.x). É o caso da VPS atual da Guardian
  Labs: as labels são ignoradas e o roteamento vem de um `.toml` estático. Este compose entra na
  rede externa `proxy`, e as rotas ficam em
  [`infra/traefik/payorder_dynamic.toml`](../traefik/payorder_dynamic.toml) (roteia por
  `container_name`). Persistência em **volumes docker nomeados** (`payorder_pg`/`payorder_redis`).

```bash
# 1) copiar as rotas para o Traefik existente (hot-reload, sem restart):
cp infra/traefik/payorder_dynamic.toml ~/DockerConfig/traefik/dynamic/
# 2) subir a stack (Testnet):
docker compose -p payorder -f infra/docker/docker-compose.traefik.yml --env-file infra/docker/.env.vps config
docker compose -p payorder -f infra/docker/docker-compose.traefik.yml run --rm migrate
docker compose -p payorder -f infra/docker/docker-compose.traefik.yml up -d
```

## Princípios

- Nunca commitar segredos — apenas `.env*.example`.
- Imagens mínimas, usuário não-root, healthchecks em todos os serviços de longa duração.
- Testnet apenas; Mainnet rejeitada pela configuração da aplicação.
