SHELL := /usr/bin/env bash

.PHONY: run-local

run-local:
	@if [ ! -f ".env" ]; then \
		echo ".env file is required in repo root."; \
		echo "Example:"; \
		echo "  BOT_DATABASE_URL=postgres://user:pass@host:5432/db"; \
		exit 1; \
	fi
	@set -a; . ".env"; set +a; \
	if [ -z "$$BOT_DATABASE_URL" ]; then \
		echo "BOT_DATABASE_URL is required in .env."; \
		echo "Example:"; \
		echo "  BOT_DATABASE_URL=postgres://user:pass@host:5432/db"; \
		exit 1; \
	fi; \
	echo "Starting app with config from .env"; \
	pnpm -C packages/app start
