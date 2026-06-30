#!/usr/bin/env bash
#
# Deploy the PayOrder Soroban contract to the Stellar Testnet.
#
# Pipeline: ensure tooling -> build WASM -> deploy -> initialize(admin) -> smoke test.
# The resulting CONTRACT_ID is printed and written to contracts/payorder/deployments/testnet.json
# so it can be recorded in the contract README and configured as SOROBAN_CONTRACT_ID in the
# backend environment.
#
# Usage:
#   infra/scripts/deploy-contract.sh
#
# Environment variables (all optional):
#   STELLAR_IDENTITY        Name of the stellar CLI identity to use as admin/source.
#                           Default: "payorder-admin" (created + funded via Friendbot if absent).
#   SOROBAN_ADMIN_SECRET    Admin secret seed (S...). If set, it is imported as STELLAR_IDENTITY
#                           instead of generating a new key.
#   ADMIN_PUBKEY            Admin public key (G...) passed to initialize(). Defaults to the
#                           public key of STELLAR_IDENTITY.
#   NETWORK                 Stellar network name. Default: "testnet".
#   RUN_SMOKE               "1" (default) to register a throwaway order and read it back.
#
# Secrets must never be committed. Pass them via the environment / CI secrets only.

set -euo pipefail

# --- locations --------------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONTRACT_DIR="${REPO_ROOT}/contracts/payorder"
WASM_TARGET="wasm32v1-none"
WASM_PATH="${CONTRACT_DIR}/target/${WASM_TARGET}/release/payorder.wasm"
DEPLOYMENTS_DIR="${CONTRACT_DIR}/deployments"

# --- configuration ----------------------------------------------------------------------------

NETWORK="${NETWORK:-testnet}"
STELLAR_IDENTITY="${STELLAR_IDENTITY:-payorder-admin}"
RUN_SMOKE="${RUN_SMOKE:-1}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

# --- 1. tooling -------------------------------------------------------------------------------

if ! command -v stellar >/dev/null 2>&1; then
  log "Stellar CLI not found. Installing via cargo (this can take a few minutes)..."
  cargo install --locked stellar-cli
fi
log "Using $(stellar --version | head -n1)"

if ! rustup target list --installed 2>/dev/null | grep -qx "${WASM_TARGET}"; then
  log "Adding Rust target ${WASM_TARGET}"
  rustup target add "${WASM_TARGET}"
fi

# --- 2. network + identity --------------------------------------------------------------------

log "Configuring network '${NETWORK}'"
stellar network add "${NETWORK}" \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  2>/dev/null || true

if [[ -n "${SOROBAN_ADMIN_SECRET:-}" ]]; then
  log "Importing admin identity '${STELLAR_IDENTITY}' from SOROBAN_ADMIN_SECRET"
  printf '%s' "${SOROBAN_ADMIN_SECRET}" | stellar keys add "${STELLAR_IDENTITY}" --secret-key 2>/dev/null || true
elif ! stellar keys address "${STELLAR_IDENTITY}" >/dev/null 2>&1; then
  log "Generating + funding admin identity '${STELLAR_IDENTITY}' (Friendbot)"
  stellar keys generate "${STELLAR_IDENTITY}" --network "${NETWORK}" --fund
fi

ADMIN_PUBKEY="${ADMIN_PUBKEY:-$(stellar keys address "${STELLAR_IDENTITY}")}"
log "Admin public key: ${ADMIN_PUBKEY}"

# --- 3. build ---------------------------------------------------------------------------------

log "Building contract WASM (${WASM_TARGET}, release)"
( cd "${CONTRACT_DIR}" && cargo build --target "${WASM_TARGET}" --release )
[[ -f "${WASM_PATH}" ]] || { err "WASM not found at ${WASM_PATH}"; exit 1; }

# Optimize the WASM when the optional subcommand is available.
if stellar contract optimize --help >/dev/null 2>&1; then
  log "Optimizing WASM"
  stellar contract optimize --wasm "${WASM_PATH}"
  [[ -f "${WASM_PATH%.wasm}.optimized.wasm" ]] && WASM_PATH="${WASM_PATH%.wasm}.optimized.wasm"
fi

# --- 4. deploy --------------------------------------------------------------------------------

log "Deploying contract to ${NETWORK}"
CONTRACT_ID="$(stellar contract deploy \
  --wasm "${WASM_PATH}" \
  --source "${STELLAR_IDENTITY}" \
  --network "${NETWORK}")"
log "Deployed CONTRACT_ID: ${CONTRACT_ID}"

# --- 5. initialize ----------------------------------------------------------------------------

log "Initializing admin authority"
stellar contract invoke \
  --id "${CONTRACT_ID}" \
  --source "${STELLAR_IDENTITY}" \
  --network "${NETWORK}" \
  -- initialize --admin "${ADMIN_PUBKEY}"

# --- 6. record --------------------------------------------------------------------------------

mkdir -p "${DEPLOYMENTS_DIR}"
DEPLOYMENT_FILE="${DEPLOYMENTS_DIR}/${NETWORK}.json"
cat > "${DEPLOYMENT_FILE}" <<JSON
{
  "network": "${NETWORK}",
  "contract_id": "${CONTRACT_ID}",
  "admin": "${ADMIN_PUBKEY}",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
log "Recorded deployment at ${DEPLOYMENT_FILE}"

# --- 7. smoke test ----------------------------------------------------------------------------

if [[ "${RUN_SMOKE}" == "1" ]]; then
  log "Smoke test: register an order and read it back via get_order"
  ORDER_ID="$(printf '%064x' 1)"   # 32-byte id, all zero except trailing 0x01
  DATA_HASH="$(printf 'aa%.0s' {1..32})"
  TENANT_REF="$(printf 'bb%.0s' {1..32})"
  NATIVE_SAC="$(stellar contract id asset --asset native --network "${NETWORK}")"
  log "Native XLM SAC: ${NATIVE_SAC}"

  stellar contract invoke \
    --id "${CONTRACT_ID}" \
    --source "${STELLAR_IDENTITY}" \
    --network "${NETWORK}" \
    -- register_order \
    --order_id "${ORDER_ID}" \
    --data_hash "${DATA_HASH}" \
    --tenant_ref "${TENANT_REF}" \
    --receiver "${ADMIN_PUBKEY}" \
    --token "${NATIVE_SAC}" \
    --amount 1000000 \
    --asset '{"code":"XLM","issuer":null}' \
    --due_ledger 0

  log "get_order result:"
  stellar contract invoke \
    --id "${CONTRACT_ID}" \
    --source "${STELLAR_IDENTITY}" \
    --network "${NETWORK}" \
    -- get_order --order_id "${ORDER_ID}"
fi

# --- done -------------------------------------------------------------------------------------

cat <<DONE

✅ Done.

CONTRACT_ID = ${CONTRACT_ID}

Next steps:
  1. Set SOROBAN_CONTRACT_ID=${CONTRACT_ID} in the backend environment.
  2. Record the CONTRACT_ID in contracts/payorder/README.md (Deployments section).
DONE
