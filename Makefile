.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose
API := apps/api

.PHONY: help setup dev api web worker up down logs db.reset migrate seed types test test.api lint fmt verify clean

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

test: test.api ## Run all tests
	@test -d apps/web && npm run test --workspaces --if-present || true

test.api: ## Run API tests
	cd $(API) && uv run pytest -q

lint: ## Lint and typecheck everything
	bash .claude/verify.sh

fmt: ## Format everything
	cd $(API) && uv run ruff format . && uv run ruff check --fix .
	@test -d apps/web && npm run lint --workspaces --if-present -- --fix || true

verify: lint test ## Full gate: lint, typecheck, tests

EVALS := tools/evals

eval.setup: ## Clone and install the killmysaas-evals judge harness
	@test -d $(EVALS) || git clone -q https://forge.smol.ai/swyx/killmysaas-evals.git $(EVALS)
	cd $(EVALS) && git pull -q && npm install --silent
	@cp -f evalconfig.json $(EVALS)/evalconfig.json
	@echo "Ready. Needs ANTHROPIC_API_KEY exported. Try: make eval.pilot"

eval.list: ## Show the areas, scenarios and rubric the judge will run
	cd $(EVALS) && npm run --silent list

eval.pilot: ## Cheap single-area probe (~\$0.50). AREA=call-for-papers make eval.pilot
	@test -n "$$ANTHROPIC_API_KEY" || { echo "export ANTHROPIC_API_KEY first"; exit 1; }
	@cp -f evalconfig.json $(EVALS)/evalconfig.json
	cd $(EVALS) && npm run eval -- \
		--areas $${AREA:-call-for-papers} --max-turns 22 \
		--agent-model claude-haiku-4-5 --judge-model claude-sonnet-5

eval: ## Full scored run against the URL in evalconfig.json (~\$2-10)
	@test -n "$$ANTHROPIC_API_KEY" || { echo "export ANTHROPIC_API_KEY first"; exit 1; }
	@cp -f evalconfig.json $(EVALS)/evalconfig.json
	cd $(EVALS) && npm run eval -- --include-optional

eval.report: ## Open the most recent report
	@open $$(ls -td $(EVALS)/runs/*/ | head -1)report.html

clean: ## Remove caches and build output
	find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(API)/.pytest_cache $(API)/.ruff_cache $(API)/.mypy_cache
