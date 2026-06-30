# PayOrder W3 Guardian — Next.js frontend image (TASK-027). Uses Next's `standalone` output so
# the runtime stage carries only the traced server bundle + a minimal node_modules.
#
# NOTE: `NEXT_PUBLIC_*` values are inlined into the client bundle **at build time**, so they are
# passed as build args (per environment) rather than runtime env. Compose/CI supply them.

# ---- deps + build ----------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

# Public runtime config (inlined at build time). Defaults match the local stack.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
ARG NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ARG NEXT_PUBLIC_EXPLORER_BASE_URL=https://stellar.expert/explorer/testnet
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_HORIZON_URL=$NEXT_PUBLIC_HORIZON_URL \
    NEXT_PUBLIC_SOROBAN_RPC_URL=$NEXT_PUBLIC_SOROBAN_RPC_URL \
    NEXT_PUBLIC_EXPLORER_BASE_URL=$NEXT_PUBLIC_EXPLORER_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1

# `@payorder/shared` must be built before the Next build (it is transpiled from its `dist`).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @payorder/shared \
  && npm run build --workspace @payorder/web

# ---- runtime ---------------------------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone bundle (server.js + traced node_modules + workspace packages), then the static
# assets the standalone server expects under the app's `.next/static`. With the tracing root at
# the monorepo root, the bundle preserves the `apps/web/...` path layout.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
