.PHONY: help doctor setup dev dev-build dev-real up down logs test-unit test-e2e

help:
	@echo "doctor      Check local prerequisites and safe defaults"
	@echo "setup       Install dependencies and prepare images (one time)"
	@echo "dev         Start the warm local Fake Provider stack (<=30s)"
	@echo "dev-build   Rebuild and start the local Fake Provider stack"
	@echo "dev-real    Start with ignored real-provider overrides"
	@echo "down        Stop the local stack"
	@echo "logs        Follow local stack logs"
	@echo "test-unit   Run focused unit contracts"
	@echo "test-e2e    Run the Playwright end-to-end test"

doctor:
	pnpm doctor

setup:
	pnpm setup

dev:
	pnpm dev

dev-build:
	pnpm dev:build

dev-real:
	pnpm dev:real

up:
	pnpm dev

down:
	pnpm down

logs:
	pnpm logs

test-unit:
	pnpm test:unit

test-e2e:
	pnpm test:e2e
