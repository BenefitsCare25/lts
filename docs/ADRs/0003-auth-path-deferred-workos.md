# ADR 0003: Auth path — Auth.js Credentials now, WorkOS later

Date: 2026-04-27
Status: Accepted

## Context

`docs/PHASE_1_BUILD_PLAN_v2.md` §8 S2 specifies WorkOS AuthKit for SSO + MFA, with the AC reading "a user with role TENANT_ADMIN can log in to /admin; SSO works for Google + Microsoft; MFA prompt fires on first login." The S2 code landed in that shape and is preserved in git history at commit `dd34a89`.

When the time came to verify S8 (Insurer Registry CRUD UI) end-to-end through the browser, two things became apparent:

1. The `/admin` shell was rendering `AuthDisabledNotice` because no WorkOS project was provisioned. To unlock UI verification we'd need to: create a WorkOS project, register a redirect URI, generate a cookie password, and wire four env vars into the Container App. Real work, but only valuable if we want SSO right now.
2. We don't yet have an external customer expecting SSO. The current need is a developer-friendly auth path that lets the human and Claude verify each registry story in the browser as it lands. WorkOS is a paid SaaS dependency built around enterprise SSO procurement — overkill for "I am the only user."

The user explicitly requested option B from a three-way choice ("provision WorkOS now / swap to Auth.js / skip auth, keep building"): swap to Auth.js for now, return to WorkOS when a real prospect needs SSO.

## Decision

Adopt **Auth.js v5 (`next-auth@5.0.0-beta.25`)** with a **Credentials provider** (email + bcrypt-hashed password) for Phase 1 dev/staging. JWT sessions, no DB adapter — Prisma owns the `User` row, Auth.js owns the cookie.

Boundaries:

- `apps/web/src/server/auth/config.ts` is the single Auth.js config. The `getSession()` / `requireSession()` helpers in `session.ts` keep their existing shape so no consumer has to know which provider is active.
- Schema gets a `User.passwordHash String?` column (migration `20260427074432_add_user_password_hash`). `User.workosUserId String? @unique` is **kept** in the schema as a no-op forward-compat hook; Phase 1B doesn't reference it.
- Seed creates a dev admin (`admin@acme-brokers.local` / `admin123`, overridable via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars) so verification works on the staging URL the moment the deploy lands.
- WorkOS code (callback route, AuthKit middleware, `@workos-inc/authkit-nextjs` dep) is **deleted**, not commented out. Git history is the rollback path. Per CLAUDE.md "no backwards-compatibility shims."

Container App env vars: `AUTH_SECRET` (32-byte JWT key, secretref), `AUTH_TRUST_HOST=true` (required behind Container Apps ingress), `AUTH_URL` (the public origin so Auth.js builds correct callback URLs).

## Consequences

**What becomes easier:**

- End-to-end UI verification on staging works the moment a deploy lands. No external SaaS provisioning blocks story shipping.
- Local dev works without `.env` ceremony — `AUTH_SECRET` is optional in dev (Auth.js generates an ephemeral secret) and the seed admin is always there.
- The cost line drops by one paid SaaS item (~$0 dev → $0 dev).

**What becomes harder:**

- S2's plan AC about "SSO works for Google + Microsoft" is **not satisfied** by current code. Same for MFA. The Phase 1 Definition of Done explicitly assumes WorkOS by way of SEC-001 (MFA for all users). We're carrying a documented gap until the WorkOS swap-back lands.
- The seed admin's password is a known weak default. Acceptable because (a) staging is gated by Auth.js JWT cookies which need a sign-in to mint; (b) the Container App URL is not public-indexed; (c) any real prospect demo gets a fresh tenant + invite flow before they touch it.
- Adding more auth providers (Google, GitHub) to the Credentials-only config is a 30-line change but isn't covered here.

**What we'd revisit:**

- **Trigger to re-add WorkOS:** the first prospect that asks for SSO with their corporate IdP, or the first MAS TRM compliance review (whichever comes first). Estimated effort: 4-6 hours — `User.workosUserId` is already there, the `Session` type already has a `roles[]` slot, and the swap is contained in `apps/web/src/server/auth/`.
- If multiple prospects line up before the WorkOS work, consider a side-by-side mode (both providers active, picked by env). Avoids a hard cutover.

## Alternatives considered

**Provision WorkOS now (option A).** ~10 minutes of dashboard clicking + 4 secrets. Right call for a production trajectory, but trades velocity for nothing while the only user is the developer.

**Skip auth verification entirely, keep building (option C).** Lets us ship S10–S35 without ever opening the UI. Rejected because we lose the per-story acceptance check; bugs accumulate in the JSX layer with no one looking at it.

**Custom signed-cookie auth (no library).** ~150 lines of code, no dep. Tempting but reinvents the wheel — Auth.js gives us session refresh, callback chaining, and a sign-out flow for free.

**Keep WorkOS code dormant behind a feature flag.** Two code paths, twice the surface. Per CLAUDE.md scope discipline, removing the unused path is correct.

## Re-add path (when triggered)

1. `pnpm add @workos-inc/authkit-nextjs` in `apps/web`.
2. Restore `apps/web/src/app/api/auth/callback/route.ts` from git history (commit `fbfcfe9` removed it — `git show fbfcfe9^:apps/web/src/app/api/auth/callback/route.ts`).
3. Add a second provider entry to `apps/web/src/server/auth/config.ts` referencing AuthKit.
4. On first WorkOS sign-in for an existing user, populate `User.workosUserId` and either keep or null out `User.passwordHash`.
5. Provision the WorkOS project + dev organisation and add 4 env vars to the Container App.
6. Update PROGRESS.md S2 footnote and tick the Phase 1 Definition of Done item for SEC-001.
