#!/usr/bin/env bash
#
# Deploy the PayOrder stack to the VPS behind the existing Traefik (TASK-029 / spec 14 §3,§6).
#
# Pipeline: pull images -> apply migrations (one-shot) -> up -d -> wait healthy -> smoke test.
# Safe to re-run (idempotent migrations; Traefik only routes healthy containers). Designed to
# run ON the VPS (the CI deploy job invokes it over SSH from the checked-out repo).
#
# Usage:
#   IMAGE_TAG=<sha> infra/scripts/deploy.sh
#
# Environment variables:
#   IMAGE_TAG        Image tag to deploy (e.g. commit SHA). Overrides the value in ENV_FILE.
#   ENV_FILE         Path to the VPS env file. Default: infra/docker/.env.vps
#   COMPOSE_FILE     Compose file. Default: infra/docker/docker-compose.vps.yml
#   PROJECT          Compose project name. Default: payorder
#   SMOKE_URL        Base URL for the post-deploy smoke test. Default: derived from API_DOMAIN
#                    in ENV_FILE (https://${API_DOMAIN}). Set to "" to skip the smoke test.
#   SMOKE_RETRIES    Smoke-test attempts before failing. Default: 30 (≈ retries × 5s).
#
# Secrets (DB password, JWT/webhook/admin secrets) live ONLY in ENV_FILE on the VPS, never here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${ENV_FILE:-infra/docker/.env.vps}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.vps.yml}"
PROJECT="${PROJECT:-payorder}"
SMOKE_RETRIES="${SMOKE_RETRIES:-30}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

[[ -f "${ENV_FILE}" ]] || { err "env file not found: ${ENV_FILE} (copy .env.vps.example and fill it in)"; exit 1; }

# Allow IMAGE_TAG to be overridden from the caller (CI passes the commit SHA). When set, export
# it so Compose interpolation uses it regardless of the value inside ENV_FILE.
if [[ -n "${IMAGE_TAG:-}" ]]; then
  export IMAGE_TAG
  log "Deploying IMAGE_TAG=${IMAGE_TAG}"
fi

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")

# Resolve the smoke-test URL from API_DOMAIN unless explicitly provided.
if [[ -z "${SMOKE_URL+x}" ]]; then
  API_DOMAIN="$(grep -E '^API_DOMAIN=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  SMOKE_URL="${API_DOMAIN:+https://${API_DOMAIN}}"
fi

# --- 0. validate -------------------------------------------------------------------------------
log "Validating compose configuration"
"${COMPOSE[@]}" config -q

# --- 1. pull -----------------------------------------------------------------------------------
log "Pulling images"
"${COMPOSE[@]}" pull

# --- 2. migrate (one-shot, before api/worker) --------------------------------------------------
log "Applying database migrations"
"${COMPOSE[@]}" run --rm migrate

# --- 3. up -------------------------------------------------------------------------------------
log "Starting / updating services"
"${COMPOSE[@]}" up -d --remove-orphans

"${COMPOSE[@]}" ps

# --- 4. smoke test -----------------------------------------------------------------------------
if [[ -z "${SMOKE_URL}" ]]; then
  log "SMOKE_URL empty — skipping post-deploy smoke test"
  exit 0
fi

log "Smoke test against ${SMOKE_URL} (/health, /ready)"
for attempt in $(seq 1 "${SMOKE_RETRIES}"); do
  if curl -fsS --max-time 5 "${SMOKE_URL}/health" >/dev/null 2>&1; then
    log "/health OK (attempt ${attempt})"
    if curl -fsS --max-time 5 "${SMOKE_URL}/ready" >/dev/null 2>&1; then
      log "/ready OK"
    else
      err "/ready not green yet (DB/Redis/RPC) — check 'docker compose -p ${PROJECT} logs api'"
      exit 1
    fi
    log "✅ Deploy successful."
    exit 0
  fi
  sleep 5
done

err "Smoke test failed: ${SMOKE_URL}/health did not become healthy after ${SMOKE_RETRIES} attempts"
exit 1
