# PayOrder W3 Guardian — developer entrypoints (TASK-027 / spec 12 §4).
#
# The local stack is one command away: `make up`. Stellar/Soroban talk to the public Testnet
# via env, so no chain container is needed.

SHELL := /bin/bash

DOCKER_DIR   := infra/docker
ENV_LOCAL    := $(DOCKER_DIR)/.env.local
ENV_EXAMPLE  := $(DOCKER_DIR)/.env.local.example
COMPOSE_LOCAL := docker compose --env-file $(ENV_LOCAL) -f $(DOCKER_DIR)/docker-compose.local.yml
COMPOSE_VPS   := docker compose -p payorder -f $(DOCKER_DIR)/docker-compose.vps.yml

.DEFAULT_GOAL := help
.PHONY: help env up down down-volumes restart logs ps build migrate seed test e2e config vps-config

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Create infra/docker/.env.local from the example if missing
	@test -f $(ENV_LOCAL) || (cp $(ENV_EXAMPLE) $(ENV_LOCAL) && echo "Created $(ENV_LOCAL) — review its values.")

up: env ## Build and start the full local stack (detached)
	$(COMPOSE_LOCAL) up -d --build

down: ## Stop the stack, keep volumes (data persists)
	$(COMPOSE_LOCAL) down

down-volumes: ## Stop the stack and delete volumes (wipes db/redis)
	$(COMPOSE_LOCAL) down -v

restart: ## Recreate services without rebuilding images
	$(COMPOSE_LOCAL) up -d

logs: ## Follow logs for all services
	$(COMPOSE_LOCAL) logs -f

ps: ## Show service status
	$(COMPOSE_LOCAL) ps

build: env ## Build images without starting
	$(COMPOSE_LOCAL) build

migrate: env ## Apply database migrations (one-shot)
	$(COMPOSE_LOCAL) run --rm migrate

seed: env ## Seed an admin + an active tenant with a wallet
	$(COMPOSE_LOCAL) run --rm api node apps/api/dist/infrastructure/persistence/seed.js

test: ## Run the full unit/integration test suite (host)
	npm test

e2e: ## Run Playwright E2E against the running stack
	npm run e2e --workspace @payorder/web

config: env ## Validate the local compose file
	$(COMPOSE_LOCAL) config -q && echo "local compose OK"

vps-config: ## Validate the VPS compose file (dry-run, no secrets needed)
	$(COMPOSE_VPS) --env-file $(DOCKER_DIR)/.env.vps.example config -q && echo "vps compose OK"
