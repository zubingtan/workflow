.PHONY: help setup doctor up down logs smoke-test support-bundle verify-m0

EVIDENCE_DIR ?= artifacts/acceptance/M0/$(shell date -u +%Y%m%dT%H%M%SZ)-$(shell node -e 'process.stdout.write(crypto.randomUUID())')

help:
	@echo "setup       Install dependencies and create a local environment file"
	@echo "doctor      Check local bootstrap prerequisites"
	@echo "up          Build and start the local stack"
	@echo "down        Stop the local stack"
	@echo "logs        Follow local stack logs"
	@echo "smoke-test  Check the running app readiness endpoint"
	@echo "support-bundle  Generate a redacted diagnostic bundle"
	@echo "verify-m0   Run the complete M0 acceptance gate"

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
	node scripts/acceptance/smoke-test.mjs http://localhost:$${APP_PORT:-3000}/api/health/ready

support-bundle:
	node scripts/acceptance/support-bundle.mjs --evidence-dir "$(EVIDENCE_DIR)"

verify-m0:
	node scripts/acceptance/m0-acceptance.mjs \
		--evidence-dir "$(EVIDENCE_DIR)" \
		--generate scripts/acceptance/generate-evidence.mjs --generate-dir "$(EVIDENCE_DIR)" \
		--test "npm test" \
		--test "pnpm test:definition" \
		--test "pnpm test:runtime-contract" \
		--test "pnpm test:runtime" \
		--test "pnpm test:failure:unit" \
		--test "pnpm test:failure:pg" \
		--test "test/bootstrap/system-bootstrap.sh" \
		--test "test/runtime/async-happy-path.system.sh" \
		--test "test/failure/failure-crash-restart.system.sh" \
		--test "pnpm test:e2e" \
		--support scripts/acceptance/support-bundle.mjs --support-dir "$(EVIDENCE_DIR)" \
		--seal scripts/acceptance/seal-evidence.mjs --seal-dir "$(EVIDENCE_DIR)" \
		--validate scripts/acceptance/validate-evidence.mjs --validate-dir "$(EVIDENCE_DIR)"
