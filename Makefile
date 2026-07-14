.PHONY: help setup doctor up down logs smoke-test verify-m0

help:
	@echo "setup       Install dependencies and create a local environment file"
	@echo "doctor      Check local bootstrap prerequisites"
	@echo "up          Build and start the local stack"
	@echo "down        Stop the local stack"
	@echo "logs        Follow local stack logs"
	@echo "smoke-test  Check the running app readiness endpoint"
	@echo "verify-m0   M0 acceptance gate (REWORK placeholder)"

setup:
	npm install --global pnpm@11.13.0
	pnpm install --frozen-lockfile
	@test -f .env || cp .env.example .env

doctor:
	node --env-file-if-exists=.env scripts/doctor.mjs

up:
	docker compose --env-file .env up --build -d

down:
	docker compose --env-file .env down --remove-orphans

logs:
	docker compose --env-file .env logs --follow

smoke-test:
	curl --fail --silent --show-error http://localhost:$${APP_PORT:-3000}/api/health/ready

verify-m0:
	@echo "REWORK: full M0 acceptance is not implemented yet"
	@exit 1
