# =============================================================
# Insurance SaaS — production Dockerfile for the Next.js app.
#
# Multi-stage build:
#   1. deps   — install all workspace deps with frozen lockfile
#   2. build  — generate Prisma client + run `next build`
#                 (next.config.mjs sets output: "standalone")
#   3. run    — minimal alpine runtime serving the standalone server
#
# Image is pushed to ACR by scripts/deploy-staging.sh and pulled
# by the Container App defined in infra/bicep/modules/container-app.bicep.
# =============================================================

ARG NODE_VERSION=22.11.0
ARG PNPM_VERSION=9.15.4

# ---- 1. deps ----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
ARG PNPM_VERSION
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/catalogue-schemas/package.json packages/catalogue-schemas/
COPY packages/shared-types/package.json packages/shared-types/
COPY prisma/ prisma/

RUN pnpm install --frozen-lockfile

# ---- 2. build ---------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .

# Prisma client is generated against the schema in prisma/schema.prisma.
RUN pnpm prisma generate
# STANDALONE_BUILD enables next.config.mjs's output:'standalone' branch.
RUN STANDALONE_BUILD=true pnpm --filter @insurance-saas/web build

# Dereference pnpm's symlinked node_modules into a flat tree at
# /opt/prisma-runtime. Only the prisma CLI + engines are needed at
# startup for `prisma migrate deploy`; the generated @prisma/client
# is already inside the Next standalone bundle (Next traces it).
RUN mkdir -p /opt/prisma-runtime/node_modules && \
    cp -RL node_modules/prisma /opt/prisma-runtime/node_modules/ && \
    cp -RL node_modules/@prisma /opt/prisma-runtime/node_modules/

# ---- 3. run -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# next.config.mjs sets output: "standalone" — the server bundle lands
# at apps/web/.next/standalone with all required files traced.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Prisma CLI + migrate engine + schema/migrations. Needed at startup
# so the entrypoint can run `prisma migrate deploy`. The /opt/prisma-runtime
# tree was pre-flattened in the build stage to avoid pnpm's symlink layout.
COPY --from=build /repo/prisma ./prisma
COPY --from=build /opt/prisma-runtime/node_modules ./node_modules

# Entrypoint runs `prisma migrate deploy` before starting the server.
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Non-root user — Container Apps runs containers as PID 1.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

# Run pending migrations, then exec the standalone server (PID 1).
ENTRYPOINT ["./entrypoint.sh"]
