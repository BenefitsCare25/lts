#!/usr/bin/env bash
# scripts/dev-setup.sh — bootstrap a fresh local dev environment.
#
# Idempotent: rerun safely after pulling new migrations or seed data.
#
# What it does:
#   1. Checks required tooling (Node 20+, pnpm 9+, Docker).
#   2. Copies .env.example to .env if missing.
#   3. Brings up Postgres 16 + Redis 7 via docker compose.
#   4. Installs pnpm dependencies.
#   5. Generates the Prisma client.
#   6. Runs migrations against the local database.
#   7. Runs the seed script.
#
# After this exits cleanly, `pnpm dev` should serve a working app at
# http://localhost:3000 with a populated catalogue.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf "\033[1;36m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

require() {
  local cmd="$1"
  local hint="$2"
  command -v "$cmd" >/dev/null 2>&1 || fail "missing '$cmd' — $hint"
}

# ── 1. Tooling checks ──────────────────────────────────────────────────────
log "checking tooling"
require node "install Node.js 20 LTS (https://nodejs.org/)"
require pnpm "install pnpm 9+ (https://pnpm.io/installation)"
require docker "install Docker Desktop (https://docs.docker.com/get-docker/)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node 20 LTS or newer required (found $(node --version))"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "'docker compose' (v2) required — please update Docker"
fi

# ── 2. Env file ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  log "creating .env from .env.example"
  cp .env.example .env
else
  log ".env already exists — leaving untouched"
fi

# ── 3. Docker services ─────────────────────────────────────────────────────
log "starting Postgres + Redis (docker compose)"
docker compose up -d postgres redis

log "waiting for Postgres to accept connections"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U lts -d lts >/dev/null 2>&1; then
    log "postgres ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "postgres did not become ready in 30s"
  fi
  sleep 1
done

# ── 4. Dependencies ────────────────────────────────────────────────────────
log "installing pnpm dependencies"
pnpm install --frozen-lockfile=false

# ── 5. Prisma client ───────────────────────────────────────────────────────
log "generating Prisma client"
pnpm prisma generate

# ── 6. Migrations ──────────────────────────────────────────────────────────
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null || true)" ]; then
  log "running prisma migrate deploy"
  pnpm prisma migrate deploy
else
  log "no migrations yet — running prisma db push to sync schema"
  pnpm prisma db push --skip-generate
fi

# ── 7. Seed ────────────────────────────────────────────────────────────────
log "seeding development dataset"
pnpm prisma db seed

cat <<'BANNER'

  ✓ dev environment ready

  Next steps:
    pnpm dev               # http://localhost:3000
    pnpm prisma studio     # browse the DB at http://localhost:5555

BANNER
