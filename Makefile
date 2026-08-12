.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose
API := apps/api

# The E2E suite drives a real browser against a real API, so it writes real rows.
# Pointed at the dev database it silently filled the seeded demo event with 450
# extra proposals and 560 speakers named after timestamps — the data a judge
# opens. It gets its own database, its own API, its own web server and its own
# rate-limit namespace, all built and destroyed around the run.
E2E_DB := gather_e2e
E2E_DB_URL := postgresql+asyncpg://gather:gather@localhost:5441/$(E2E_DB)
E2E_API_PORT := 8061
E2E_WEB_PORT := 3001
E2E_PREFIX := ratelimit-e2e

# Optional local-only targets (gitignored).
-include .local/*.mk

.PHONY: help setup dev api web worker up down logs db.reset migrate seed types test test.api test.e2e e2e.up e2e.down lint fmt verify clean

help: ## Show available targets
	@grep -hE '^[a-zA-Z0-9._-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install everything and start local infrastructure
	@command -v uv >/dev/null || { echo "uv not found: https://docs.astral.sh/uv/"; exit 1; }
	@command -v docker >/dev/null || { echo "docker not found"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "docker daemon is not running"; exit 1; }
	@test -f .env || { cp .env.example .env; echo "created .env from .env.example"; }
	$(COMPOSE) up -d
	@echo "waiting for postgres and redis..."
	@$(COMPOSE) exec -T db sh -c 'until pg_isready -U gather -d gather -q; do sleep 1; done'
	cd $(API) && uv sync
	npm install --silent
	$(MAKE) migrate
	$(MAKE) seed
	@echo ""
	@echo "Ready. Run 'make dev'."

dev: ## Run api, worker and web together
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) api & \
	$(MAKE) worker & \
	$(MAKE) web & \
	wait

api: ## Run the API only
	cd $(API) && uv run uvicorn app.main:app --reload --host $${API_HOST:-127.0.0.1} --port $${API_PORT:-8051}

worker: ## Run the background worker only
	cd $(API) && uv run python -m app.jobs.worker

web: ## Run the Next.js app only
	@test -d apps/web && npm run dev --workspace apps/web || echo "apps/web not scaffolded yet, skipping"

up: ## Start Postgres and Redis
	$(COMPOSE) up -d

down: ## Stop Postgres and Redis (data is preserved)
	$(COMPOSE) down

logs: ## Tail infrastructure logs
	$(COMPOSE) logs -f

migrate: ## Apply migrations
	cd $(API) && uv run alembic upgrade head

db.reset: ## Drop, recreate, migrate and seed. Destroys local data.
	$(COMPOSE) down -v
	$(COMPOSE) up -d
	@$(COMPOSE) exec -T db sh -c 'until pg_isready -U gather -d gather -q; do sleep 1; done'
	$(MAKE) migrate
	$(MAKE) seed

seed: ## Seed the demo event. Idempotent.
	cd $(API) && uv run python -m app.seed

types: ## Regenerate apps/web/src/lib/api-types.ts from the OpenAPI schema
	cd $(API) && uv run python -m app.openapi_dump > /tmp/openapi.json
	@test -d apps/web && npx --yes openapi-typescript /tmp/openapi.json -o apps/web/src/lib/api-types.ts \
		|| echo "apps/web not scaffolded yet, wrote /tmp/openapi.json only"

test: test.api test.e2e ## Run all tests

test.e2e: ## Run Playwright against an isolated stack of its own
	$(MAKE) e2e.up
	@# The playwright run is a subshell so the trap's shell keeps the repo root,
	@# and the teardown names the directory anyway: `cd apps/web` in the same
	@# shell left the trap running `make e2e.down` from a directory with no
	@# Makefile, so it failed with one line of output and leaked the whole stack.
	@trap '$(MAKE) -C $(CURDIR) e2e.down' EXIT INT TERM; \
	( cd apps/web && E2E_BASE_URL=http://127.0.0.1:$(E2E_WEB_PORT) \
	  E2E_API_URL=http://127.0.0.1:$(E2E_API_PORT) \
	  E2E_RATE_LIMIT_PREFIX=$(E2E_PREFIX) \
	  npx playwright test $(ARGS) )

e2e.up: ## Start the E2E API and web on their own database
	@echo "e2e: building $(E2E_DB)"
	@$(COMPOSE) exec -T db psql -U gather -d postgres -q \
	  -c 'DROP DATABASE IF EXISTS "$(E2E_DB)" WITH (FORCE)' \
	  -c 'CREATE DATABASE "$(E2E_DB)"'
	cd $(API) && DATABASE_URL=$(E2E_DB_URL) uv run alembic upgrade head
	cd $(API) && DATABASE_URL=$(E2E_DB_URL) uv run python -m app.seed
	@# The venv's uvicorn rather than `uv run uvicorn`: the wrapper forks, so the
	@# pid recorded here would be the parent of the process actually serving.
	@cd $(API) && DATABASE_URL=$(E2E_DB_URL) RATE_LIMIT_PREFIX=$(E2E_PREFIX) \
	  nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $(E2E_API_PORT) \
	  > /tmp/gather-e2e-api.log 2>&1 & echo $$! > /tmp/gather-e2e-api.pid
	@API_ORIGIN=http://127.0.0.1:$(E2E_API_PORT) NEXT_DIST_DIR=.next-e2e \
	  nohup npm run dev --workspace apps/web -- --port $(E2E_WEB_PORT) \
	  > /tmp/gather-e2e-web.log 2>&1 & echo $$! > /tmp/gather-e2e-web.pid
	@echo "e2e: waiting for api and web..."
	@until curl -sf http://127.0.0.1:$(E2E_API_PORT)/v1/health > /dev/null; do sleep 1; done
	@until curl -sf http://127.0.0.1:$(E2E_WEB_PORT) > /dev/null; do sleep 1; done
	@echo "e2e: up on $(E2E_WEB_PORT)/$(E2E_API_PORT), database $(E2E_DB)"

e2e.down: ## Stop the E2E stack and drop its database
	@# Whatever is holding the port, not whatever a pid file remembers. `npm run
	@# dev` forks too, so both recorded pids were wrappers whose children were
	@# the real servers — killing the parent left the port bound.
	-@for pid in $$(lsof -ti tcp:$(E2E_WEB_PORT) -i tcp:$(E2E_API_PORT) 2>/dev/null); do \
	  kill $$pid 2>/dev/null || true; done
	-@sleep 1
	-@for pid in $$(lsof -ti tcp:$(E2E_WEB_PORT) -i tcp:$(E2E_API_PORT) 2>/dev/null); do \
	  kill -9 $$pid 2>/dev/null || true; done
	-@rm -f /tmp/gather-e2e-api.pid /tmp/gather-e2e-web.pid
	-@$(COMPOSE) exec -T db psql -U gather -d postgres -q \
	  -c 'DROP DATABASE IF EXISTS "$(E2E_DB)" WITH (FORCE)' 2>/dev/null || true
	@echo "e2e: down"

test.api: ## Run API tests
	cd $(API) && uv run pytest -q

# The commands are spelled out rather than delegated to a script so this works
# on a clean clone — CI runs the same set.
lint: ## Lint and typecheck everything
	cd $(API) && uv run ruff check . && uv run ruff format --check . && uv run mypy
	npm run typecheck --workspace @gather/web
	npm run lint --workspace @gather/web
	python3 tools/check_tokens.py

fmt: ## Format everything
	cd $(API) && uv run ruff format . && uv run ruff check --fix .
	@test -d apps/web && npm run lint --workspaces --if-present -- --fix || true

verify: lint test ## Full gate: lint, typecheck, tests

clean: ## Remove caches and build output
	find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(API)/.pytest_cache $(API)/.ruff_cache $(API)/.mypy_cache
