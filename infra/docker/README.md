# Infraestrutura Docker — PayOrder W3 Guardian

Empacotamento e orquestração local e em VPS (com Traefik existente). Specs detalhadas:
- Local: [`docs/specs/payorder-w3-guardian/12-docker-local.md`](../../docs/specs/payorder-w3-guardian/12-docker-local.md)
- VPS/Traefik: [`docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md`](../../docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md)
- Deploy: [`docs/specs/payorder-w3-guardian/14-deployment.md`](../../docs/specs/payorder-w3-guardian/14-deployment.md)

## Arquivos

```text
infra/
  docker/
    api.Dockerfile                     # imagem Node única: api · worker · migrate · seed (por comando)
    web.Dockerfile                     # imagem do frontend (Next.js, output standalone)
    docker-compose.payorder.local.yml  # ambiente local completo (build local)
    docker-compose.payorder.vps.yml    # deploy na VPS atrás do Traefik EXISTENTE (provider de ARQUIVO)
    .env.local.example                 # variáveis locais
    .env.payorder.vps.example          # variáveis da VPS (imagens do Docker Hub)
  traefik/
    payorder_dynamic.toml              # rotas do PayOrder para o Traefik existente (file provider)
    README.md                          # como integrar com o Traefik existente (rede externa `proxy`)
  scripts/
    deploy-contract.sh                 # build + deploy do contrato Soroban (Testnet)
    deploy.sh                          # deploy na VPS (rotas → pull → migrate → up → smoke)
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

## VPS com o Traefik existente (resumo)

A VPS da Guardian Labs já roda o Traefik singleton da stack guardian-seal, com o **provider
Docker DESABILITADO** (incompatível com Docker Engine 29.x) e roteamento pelo **provider de
ARQUIVO/diretório** (`--providers.file.directory=/dynamic`). Labels `traefik.*` são ignoradas.

- **Imagens do Docker Hub**, publicadas pelo release do CI (`.github/workflows/ci.yml`):
  `${DOCKERHUB_USERNAME}/payorder-api` e `${DOCKERHUB_USERNAME}/payorder-web`, tags
  `sha-<short>` (deploy pinado) + `latest`.
- **Project name isolado** (`-p payorder`) e nomes/volumes prefixados (`payorder_*`) — sem
  colisão com o outro produto.
- `api`/`web` entram na **rede externa** `proxy` (a mesma do Traefik existente); rede interna
  privada para `postgres`/`redis`/`worker`/`migrate` (nunca expostos).
- **Sem `ports:`** em serviços atrás do Traefik; roteamento por **container name** via
  [`infra/traefik/payorder_dynamic.toml`](../traefik/payorder_dynamic.toml) (o
  `deploy.sh` copia esse arquivo para o diretório dinâmico do Traefik a cada deploy;
  hot-reload, sem restart).
- Persistência em **volumes docker nomeados** (`payorder_pg`/`payorder_redis`).
- Domínios: `pow3.guardian-labs.xyz` (web) e `pow3-api.guardian-labs.xyz` (api); TLS via o
  resolver `le` do Traefik existente.

```bash
# deploy completo (rotas → pull → migrate → up → smoke) — o CI faz isso via SSH:
IMAGE_TAG=sha-<short> infra/scripts/deploy.sh

# ou manualmente:
cp infra/traefik/payorder_dynamic.toml ~/DockerConfig/traefik/dynamic/
docker compose -p payorder -f infra/docker/docker-compose.payorder.vps.yml --env-file infra/docker/.env.vps config -q
docker compose -p payorder -f infra/docker/docker-compose.payorder.vps.yml pull
docker compose -p payorder -f infra/docker/docker-compose.payorder.vps.yml run --rm migrate
docker compose -p payorder -f infra/docker/docker-compose.payorder.vps.yml up -d
```

> **Imagens privadas?** O pull anônimo funciona para repositórios públicos do Docker Hub. Se
> os repositórios forem privados, faça `docker login` uma vez na VPS com um access token de
> leitura.

## Princípios

- Nunca commitar segredos — apenas `.env*.example`.
- Imagens mínimas, usuário não-root, healthchecks em todos os serviços de longa duração.
- Testnet apenas; Mainnet rejeitada pela configuração da aplicação.
