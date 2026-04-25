#!/usr/bin/env bash
# =============================================================
# scripts/dev-setup.sh
#
# Bootstraps the local development environment for a fresh clone:
#   1. verifies Docker is running
#   2. ensures pnpm is available (via Corepack)
#   3. seeds .env from .env.example if missing
#   4. installs Node dependencies
#   5. brings up Postgres + Redis via docker-compose
#   6. waits for Postgres to be healthy
#   7. runs the Prisma seed (no-op stub during bootstrap)
#
# Re-run any time. Idempotent.
# =============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[dev-setup] %s\n' "$*"; }
err() { printf '[dev-setup] ERROR: %s\n' "$*" >&2; }

# ---- 1. Docker reachable -----------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed. Install Docker Desktop and re-run."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  err "Docker is installed but not running. Start Docker Desktop and re-run."
  exit 1
fi

# ---- 2. pnpm via Corepack ----------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  log "pnpm not found — enabling Corepack"
  if ! corepack enable >/dev/null 2>&1; then
    err "corepack enable failed. Install pnpm manually: 'npm i -g pnpm'."
    exit 1
  fi
fi

# ---- 3. .env from template ---------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  log ".env created from .env.example"
fi

# ---- 4. Install dependencies -------------------------------------------------
log "Installing dependencies (pnpm)..."
pnpm install

# ---- 5. Start Postgres + Redis -----------------------------------------------
log "Starting Postgres and Redis via docker compose..."
docker compose up -d

# ---- 6. Wait for Postgres ----------------------------------------------------
log "Waiting for Postgres to be ready..."
ATTEMPTS=0
MAX_ATTEMPTS=30
until docker compose exec -T postgres pg_isready -U postgres -d insurance_saas >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    err "Postgres did not become ready within 60s. Check 'docker compose logs postgres'."
    exit 1
  fi
  sleep 2
done
log "Postgres ready"

# ---- 7. Seed (no-op stub during bootstrap) -----------------------------------
# The full seed lands in Story S8. Until then this is a stub that prints
# a one-liner and exits 0. Running it now keeps the bootstrap script's
# shape stable for future sessions.
log "Running seed..."
pnpm db:seed

cat <<'EOF'

[dev-setup] Bootstrap complete.

Next steps:
  pnpm dev               start the app at http://localhost:3000
  pnpm docker:down       stop Postgres + Redis when you're done
  pnpm prisma studio     browse the database (no tables yet — see Story S6)

EOF
