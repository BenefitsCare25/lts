#!/bin/sh
# =============================================================
# Container entrypoint.
#
# 1. Run `prisma migrate deploy` against DATABASE_URL.
#    - Idempotent: a no-op when the DB is already up to date.
#    - Fails fast on a broken migration; the container exits
#      non-zero so Container Apps reports the bad revision and
#      rolls back to the previous one (failure-tolerant deploy).
# 2. Hand off to the Next.js standalone server via `exec` so
#    `node` becomes PID 1 and signals are forwarded.
#
# Why we use `node ./node_modules/prisma/build/index.js` instead
# of `npx prisma`: npm/npx isn't installed in the runtime image
# (we ship pnpm-built artifacts only). Calling the JS entry
# directly avoids a shell wrapper and works under Alpine sh.
# =============================================================
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is not set; refusing to start." >&2
  exit 1
fi

echo "[entrypoint] prisma migrate deploy..."
node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma

echo "[entrypoint] starting Next.js server..."
exec node apps/web/server.js
