# Infraestrutura Docker — PayOrder W3 Guardian

Empacotamento e orquestração local e em VPS (com Traefik existente). Specs detalhadas:
- Local: [`docs/specs/payorder-w3-guardian/12-docker-local.md`](../../docs/specs/payorder-w3-guardian/12-docker-local.md)
- VPS/Traefik: [`docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md`](../../docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md)
- Deploy: [`docs/specs/payorder-w3-guardian/14-deployment.md`](../../docs/specs/payorder-w3-guardian/14-deployment.md)

## Arquivos previstos

```text
infra/
  docker/
    api.Dockerfile            # imagem da API/worker (Node/NestJS)
    web.Dockerfile            # imagem do frontend (Next.js)
    docker-compose.local.yml  # ambiente local completo
    docker-compose.vps.yml    # deploy na VPS atrás do Traefik existente
    .env.local.example        # variáveis locais
    .env.vps.example          # variáveis da VPS
  traefik/
    README.md                 # como integrar com o Traefik existente (labels, rede externa)
  scripts/
    deploy-contract.sh        # build + deploy do contrato Soroban (Testnet)
    deploy.sh                 # deploy da stack na VPS
```

## Local (resumo)

Serviços: `postgres`, `redis`, `migrate` (one-shot), `api`, `worker`, `web`. Stellar usa a
**Testnet pública** (Horizon/Soroban RPC/Friendbot) via variáveis.

```bash
make up        # sobe tudo
make migrate   # roda migrations
make seed      # tenant + wallet de exemplo
make test      # suíte de testes
```

API em `http://localhost:3000`, Web em `http://localhost:3001`.

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

## Princípios

- Nunca commitar segredos — apenas `.env*.example`.
- Imagens mínimas, usuário não-root, healthchecks em todos os serviços de longa duração.
- Testnet apenas; Mainnet rejeitada pela configuração da aplicação.
