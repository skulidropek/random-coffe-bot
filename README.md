# Random Coffee Bot

## Requirements

- Node.js v25.2.1 (local version in use).
- pnpm (see `package.json` `packageManager` field).

## Environment

Create `.env` in the repo root:

```
# Telegram bot token from @BotFather
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN

# IANA timezone (optional, default: UTC)
BOT_TIMEZONE=UTC

# Postgres connection string (required for local run)
BOT_DATABASE_URL=postgres://user:pass@localhost:5432/coffee_bot
```

Fields to fill:

- `BOT_TOKEN` (required): Telegram bot token from @BotFather.
- `BOT_DATABASE_URL` (required for Makefile/local run): Postgres connection string.

## Run via Makefile (local)

1. Ensure Postgres is running and reachable at `BOT_DATABASE_URL`.
2. Install dependencies: `pnpm install`.
3. Start: `make run-local`.

## Run via docker-compose

1. Ensure `.env` contains at least `BOT_TOKEN` (and optional `BOT_TIMEZONE`).
2. Start services: `docker compose up`.

Notes:

- `docker-compose.yml` injects `BOT_DATABASE_URL` for the app service, pointing to the bundled Postgres container.
- Use `docker compose down` to stop and remove containers.
