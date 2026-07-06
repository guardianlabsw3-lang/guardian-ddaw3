# PayOrder W3 Guardian — Node image for the API, the worker, the one-shot migrate job and the
# seed (TASK-027). One image, many commands:
#   api      : node apps/api/dist/main.js                                    (default CMD)
#   worker   : node apps/worker/dist/index.js
#   migrate  : node apps/api/dist/infrastructure/persistence/migrate.js
#   seed     : node apps/api/dist/infrastructure/persistence/seed.js
#
# Multi-stage: a build stage compiles every TypeScript workspace; a slim runtime stage carries
# only the compiled output and the installed node_modules, runs as the non-root `node` user and
# ships a wget-based healthcheck for `/health`.

# ---- deps + build ----------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install with the lockfile, copying only manifests first so the layer caches across source edits.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

# Compile shared → api → worker (topological: each consumes the previous one's `dist`).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY openapi openapi
RUN npm run build --workspace @payorder/shared \
  && npm run build --workspace @payorder/api \
  && npm run build --workspace @payorder/worker \
  # `tsc` does not emit `.sql`; the migrator resolves migrations relative to its compiled
  # location, so copy the SQL + journal next to the compiled migrator.
  && cp -r apps/api/src/infrastructure/persistence/migrations \
        apps/api/dist/infrastructure/persistence/migrations

# ---- runtime ---------------------------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Installed dependencies (workspace symlinks resolve against the copied package dirs below).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
# `@stellar/stellar-sdk` (and its deps axios, bignumber.js, eventsource) cannot be hoisted to the
# root `node_modules` — the workspace resolves an older `@stellar/stellar-base` there (pulled by
# `@stellar/freighter-api` in the web app) — so npm nests them under the API workspace. They must
# ship too, or `apps/api/dist/**` fails at runtime with ERR_MODULE_NOT_FOUND. Node resolves them
# from the importing file's real path, so the worker (which loads the API's compiled modules) is
# covered by this same copy.
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules

COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist

# OpenAPI contract served by the public docs routes (`/docs`, `/docs/redoc`, `/docs/openapi.yaml`).
COPY --from=build /app/openapi ./openapi

# Drop privileges (the `node` user ships with the base image).
USER node

EXPOSE 3000

# Liveness probe used by Compose and Traefik (only healthy containers receive traffic).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
