# Integração com o Traefik existente (provider de ARQUIVO)

A Guardian Labs já opera um Traefik na VPS para outro produto (guardian-seal). O PayOrder
**reusa** esse Traefik sem alterá-lo. Detalhes na spec
[`13-docker-vps-traefik.md`](../../docs/specs/payorder-w3-guardian/13-docker-vps-traefik.md).

> **Importante:** esse Traefik tem o **provider Docker DESABILITADO** (incompatível com
> Docker Engine 29.x). Labels `traefik.*` são **ignoradas**. Todo o roteamento vem do
> provider de **arquivo/diretório** (`--providers.file.directory=/dynamic`), que mescla
> todos os `*.toml` do diretório numa única configuração.

## Como funciona

- As rotas do PayOrder vivem em [`payorder_dynamic.toml`](payorder_dynamic.toml), que é
  copiado para o diretório dinâmico do Traefik (o `infra/scripts/deploy.sh` faz isso
  automaticamente quando o diretório existe; Traefik hot-reloada, sem restart):

  ```bash
  cp infra/traefik/payorder_dynamic.toml ~/DockerConfig/traefik/dynamic/
  ```

- O Traefik roteia por **container name** na rede externa compartilhada `proxy`:

  | Host                         | Serviço | Backend                    |
  | ---------------------------- | ------- | -------------------------- |
  | `pow3.guardian-labs.xyz`     | web     | `http://payorder_web:3000` |
  | `pow3-api.guardian-labs.xyz` | api     | `http://payorder_api:3000` |

## Regras de coexistência

- **Não** alterar a configuração estática do Traefik existente nem os `.toml` do outro
  produto.
- **Não** redefinir middlewares globais (ex.: `https-redirect` já vem do arquivo do outro
  produto — apenas **referencie**). Todos os nomes daqui usam o prefixo `payorder-`.
- Conectar `api`/`web` à **rede externa** do Traefik (`external: true`, nome em
  `TRAEFIK_NETWORK`, default `proxy`). Descobrir o nome real com `docker network ls`.
- Usar **container names únicos** (`payorder_*`) — um alias bare (`api`/`web`) colidiria
  com o outro produto na rede compartilhada.
- **Sem `ports:`** nos serviços roteados pelo Traefik.
- TLS via o `certResolver` já configurado no Traefik existente (`le`), referenciado no
  `payorder_dynamic.toml`.

## Verificação antes do deploy

```bash
docker network ls | grep -w proxy          # confirmar a rede compartilhada
docker compose -p payorder -f infra/docker/docker-compose.payorder.vps.yml \
  --env-file infra/docker/.env.vps config -q   # validar
```
