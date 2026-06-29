# Integração com Traefik existente

A Guardian Labs já opera um Traefik na VPS para outro produto. O PayOrder **reusa** esse
Traefik sem alterá-lo. Detalhes na spec
[`13-docker-vps-traefik.md`](../../docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md).

## Regras de coexistência

- **Não** alterar a configuração estática/dinâmica do Traefik existente.
- Conectar `api`/`web` à **rede externa** do Traefik (`external: true`, nome em
  `TRAEFIK_NETWORK`). Descobrir o nome real com `docker network ls`.
- Definir **apenas** routers/services via **labels prefixadas** (`payorder-api`,
  `payorder-web`). Nunca redefinir middlewares globais ou entrypoints.
- **Sem `ports:`** nos serviços roteados pelo Traefik.
- TLS via `certresolver` já configurado (`CERT_RESOLVER`).

## Labels mínimas por serviço

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=${TRAEFIK_NETWORK}"
  - "traefik.http.routers.payorder-web.rule=Host(`${WEB_DOMAIN}`)"
  - "traefik.http.routers.payorder-web.entrypoints=websecure"
  - "traefik.http.routers.payorder-web.tls=true"
  - "traefik.http.routers.payorder-web.tls.certresolver=${CERT_RESOLVER}"
  - "traefik.http.services.payorder-web.loadbalancer.server.port=3000"
```

## Verificação antes do deploy

```bash
docker network ls | grep traefik           # confirmar nome da rede
docker compose -p payorder -f infra/docker/docker-compose.vps.yml config   # validar
```
