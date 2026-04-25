# Progress log

Running record of Claude Code sessions. Newest entries on top. Each entry: session date, session focus, what changed, what decisions were made (and why), and what's next. Future sessions append here.

---

## 2026-04-25 — Pre-story bootstrap

**Session focus.** Section 5 of `docs/build_brief.md` — pre-story environment bootstrap. Goal: a fresh clone plus `./scripts/dev-setup.sh` produces a working app at `localhost:3000` with a seeded (no-op) database.

**What landed.**

- `git init` on `main`, work on branch `chore/initial-scaffold`. Conventional commits, one concern per commit.
- Root tooling: pnpm workspace (`pnpm-workspace.yaml`, `.npmrc`), TypeScript strict (`tsconfig.base.json` + root `tsconfig.json`), Biome 1.9 (`biome.json`), `package.json` with `packageManager: pnpm@9.15.4`.
- `docker-compose.yml` with Postgres 16-alpine and Redis 7-alpine, healthchecks, named volumes.
- Next.js 15.5 App Router scaffold under `apps/web` — placeholder `/` route renders the platform name and a one-line bootstrap note. Vitest for unit tests (one smoke test passes), Playwright config + one e2e smoke spec for when the dev server is up.
- Prisma 5.22 installed at root. `prisma/seed.ts` is a no-op stub that prints a one-liner pointing at Story S8. The starter `prisma/schema.prisma` is left in place as reference content; **no migrations are generated or applied during bootstrap** — that's S6's job.
- Placeholder workspace packages: `@insurance-saas/catalogue-schemas` and `@insurance-saas/shared-types`, each with a `package.json` flagging the Phase 1 placeholder status. Real content lands in S6 / S8.
- `scripts/dev-setup.sh` — verifies Docker, enables Corepack/pnpm, copies `.env.example` → `.env`, installs deps, brings up Docker, waits for Postgres, runs the seed stub. Idempotent.
- `.github/workflows/ci.yml` — lint + format check (Biome) + typecheck + tests + build, on PR to `main` and pushes to `main`. Uses pnpm cache via `actions/cache@v4`.
- `.env.example` covers Postgres, Redis, Next.js, WorkOS (S3), Azure Blob (S17), App Insights (S1) with `[now]` / `[later]` markers indicating which stories populate each block.

**Decisions and rationale.**

1. **Empty initial migration interpretation.** No migration files exist yet. The `schema.prisma` already in the repo is treated as reference for S6. Running `pnpm install` triggers Prisma's postinstall which generates the client against that reference schema — harmless because the bootstrap app makes no DB queries.
2. **Node version pin: `>=20.18.0`.** The brief locks Node 20 LTS. Set `.nvmrc` to `20` and `engines.node` to a lower bound only (allows Node 22+ which is also LTS). This machine is on 22.18.0; install + build + tests verified there.
3. **Biome 1.9.4.** Latest stable at lockfile time. Biome 2.x is not used yet; revisit if a 2.x upgrade is needed for a specific rule.
4. **Forced-add `CLAUDE.md`.** A user-level global gitignore excludes `CLAUDE.md` by default. The build brief explicitly commits it to the repo root, so `git add -f` was used once.
5. **Per-command git identity.** `user.email` / `user.name` passed as `git -c` flags on each commit rather than writing repo-local git config — respects the "never update git config" guardrail in `CLAUDE.md`. If a different commit identity is desired, update via `git -c` overrides or set `.git/config` manually.
6. **dev-setup.sh installs pnpm via Corepack.** First-time setup on this Windows machine couldn't enable Corepack (write to `C:\Program Files\nodejs\` requires admin), so pnpm was installed via `npm install -g pnpm@9.15.4` to the user-local npm prefix instead. The script tries Corepack first and falls back to a clear error message — re-running on a Linux/macOS dev box should succeed via Corepack alone.
7. **CI does not yet run a Postgres service container.** Bootstrap has no DB-backed tests. S6/S7 will add the service block when the first integration tests land.

**Verification.**

- `pnpm install` — succeeds, generates Prisma client.
- `pnpm typecheck` — clean.
- `pnpm check` (Biome lint + format) — clean.
- `pnpm test` — 1 smoke test passes.
- `pnpm build` — Next.js production build succeeds, static-prerenders `/`.
- `dev-setup.sh` not run end-to-end this session (Docker availability not assumed). All non-Docker steps validated.

**Open items / follow-ups.**

- Push branch `chore/initial-scaffold` to GitHub once the remote exists. Hui En to create the GitHub repo and run `git remote add origin <url> && git push -u origin chore/initial-scaffold`.
- First-week checklist (build_brief section 11) still owed by the human: Azure subscription + resource group, WorkOS project + dev organization, dev Key Vault for WorkOS keys.
- Story S1 (Azure infrastructure as code via Bicep) is next.

**Commit list on this branch.**

```
chore: initial repo state with docs and base files
chore: add pnpm workspace and root tooling
chore: add docker-compose for postgres and redis
chore: scaffold next.js 15 app under apps/web
chore: add prisma seed stub for bootstrap
chore: add placeholder workspace packages
chore: add dev-setup script and ci workflow
chore: mark dev-setup.sh executable
chore: apply biome formatting and add lockfile
docs: add bootstrap progress log entry
```
