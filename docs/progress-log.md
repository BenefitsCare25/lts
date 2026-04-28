# Progress log

Running record of Claude Code sessions. Newest entries on top. Each entry: session date, session focus, what changed, what decisions were made (and why), and what's next. Future sessions append here.

---

## 2026-04-28 — S14 Policy + entities

**Session focus.** Land Screen 2 — Policy editor with PolicyEntity rows + rate-overrides JSONB. First story to deal with optimistic locking (Policy.versionId), and the first model that isn't directly tenant-scoped.

**What landed.**

- **`policies` tRPC router** under `apps/web/src/server/trpc/routers/policies.ts`. listByClient / byId / create / update / delete via `tenantProcedure`. Policy isn't in `TENANT_MODELS`, so the Prisma extension no-ops on it — every operation calls `assertClient(ctx.db, clientId)` first (a tenant-scoped findFirst that returns null cross-tenant), then runs the actual policy query against the raw `prisma` client. `byId` and `update` go further by joining through `client: { tenantId: ctx.tenantId }` for defence in depth.
- **Optimistic locking.** `update` accepts `expectedVersionId`; the server fetches the existing row's `versionId`, throws CONFLICT on mismatch, otherwise increments by 1 inside the same transaction that recreates the entity rows. The UI carries `policy.data.versionId` from the byId response into the mutation input.
- **PolicyEntity rows via delete-and-recreate** inside a Prisma `$transaction`, same pattern as PoolMembership in S10. Cross-row invariants enforced server-side: at most one `isMaster` entity per policy, no duplicate `policyNumber` within a policy. P2002 from the DB unique constraint surfaces as a friendly CONFLICT.
- **`/admin/clients/[id]/policies`** — list of policies under one client + inline create form (just policy name; entities live on the edit page where the JSONB editor needs the room).
- **`/admin/clients/[id]/policies/[policyId]/edit`** — repeating entity rows: legalName, policyNumber, address (optional), headcountEstimate (optional integer), isMaster (radio — exactly one across the form), `rateOverrides` JSON textarea. Master selector is a radio group so picking one auto-clears the others. JSON parse runs on change via `useMemo`; per-row error surface inline; submit button blocks until all rows parse. Empty text → null on save.
- **JSON encoding for Prisma.** Wrote a tiny `rateOverridesToJson(v)` helper: `null` → `Prisma.JsonNull` (literal SQL NULL), object → `Prisma.InputJsonValue`. Same gotcha as S12.
- **Client list deep-link.** Added a "Policies" button to each row of `/admin/clients` table, ahead of Edit / Delete.

**Decisions and rationale.**

1. **Don't put Policy under RLS.** Phase 1's RLS policy applies to the 8 `tenantId`-bearing tables. Policy reaches its tenant through Client. Adding RLS would either need a `tenantId` column on Policy (denormalised, drifts) or a function-based policy joining Client (more SQL surface for migrations). Application-layer assertions through `ctx.db.client` cover the case, and `findFirst` with `client: { tenantId }` is a second line of defence. Revisit if a cross-tenant Policy leak ever shows up — none can today.
2. **Create takes only the policy name; entities go on the edit page.** Two reasons. First, entities carry rateOverrides JSON and JSON-on-create is bad UX in a single-line form. Second, mirrors how brokers actually onboard — they know the policy name when they pick up the placement slip; they figure out entity counts and rate overrides only as they read it.
3. **Master selector is a radio, not a checkbox per row.** "Master policyholder" is at most one entity by definition; a radio group makes that constraint obvious in the UI. The server still validates because nothing prevents an admin from sending two `isMaster: true` rows via the API directly.
4. **Optimistic lock check goes before the entity-validation transaction.** Means a stale save returns CONFLICT without burning a transaction. The version increment happens inside the transaction so a concurrent save can't slip past.
5. **Pre-push gate is now `pnpm typecheck && pnpm check && pnpm test && pnpm build`.** Last session's S13 push tripped CI because I ran `pnpm lint` (lint only) instead of `pnpm check` (lint + format). Going forward: `check`, not `lint`.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` all clean before push.
- New routes in build manifest: `/admin/clients/[id]/policies` (1.6 kB), `/admin/clients/[id]/policies/[policyId]/edit` (2.51 kB).
- 11/11 unit tests still pass.

**Open items / next.**

- **S15 Product selection (Screen 3).** First story that exercises `Insurer.productsSupported` as a filter on the product-row dropdown. CUBER = 10 products spanning Tokio Marine + Zurich + Allied World.
- **S16 Catalogue seed scripts.** Seed the 12 default ProductTypes per v2 §3.5; will populate the now-empty `/admin/catalogue/product-types` table on staging.
- **S17 Benefit year + draft state.** Auto-create the first BenefitYear in DRAFT when a Policy is created. Likely surface as a sub-tab on the policy edit page.
- **S14 deferrals.** Plan §6.2 mentions Policy-level "Period start/end" and "Currency" fields — those belong on BenefitYear (start/end) and aren't yet on Policy at all. Currency is missing from the schema; will revisit at S17 alongside BenefitYear UI. Per-entity rateOverrides "drill-down" from §6.2 ships as a JSON textarea here — a structured per-product override editor lands at S21 (per-product config) where the catalogue schemas are already in scope.

---

## 2026-04-28 — Phase 1C kick-off (S13)

**Session focus.** Open Phase 1C — Client onboarding. Land S13 (Client CRUD, Screen 1) so we have a real list of broker clients to hang policies off in S14+.

**What landed.**

- **`referenceData` tRPC router** under `apps/web/src/server/trpc/routers/reference-data.ts`. Three queries — `countries`, `currencies`, `industries` — backed by the system-level `Country`/`Currency`/`Industry` tables seeded in S6. These tables are *not* tenant-scoped, so the router uses `protectedProcedure` (signed in is enough) rather than `tenantProcedure`. The Prisma extension that auto-injects `tenantId` would no-op on these models anyway since they aren't in the `TENANT_MODELS` set, but using a non-tenant procedure makes the intent explicit.
- **`clients` tRPC router** with full list / byId / create / update / delete via `tenantProcedure`. Zod input schema mirrors v2 §6.1 fields. Optional fields (`tradingName`, `industry`, `primaryContactName`, `primaryContactEmail`) are normalised to `null` at the schema layer so empty strings can't sneak through. Email field uses Zod's `.email()`. Status accepts `ClientStatus` via `z.nativeEnum`. Delete handles P2003 (foreign-key) as a friendly "linked policies/employees, remove those first" conflict — relevant once S14 adds Policy rows.
- **Server-side UEN validation** via `assertCountryAndIndustry`: loads the Country, runs `RegExp(country.uenPattern).test(uen)` if a pattern is present (SG `^[0-9]{8,10}[A-Z]$`, MY `^[0-9]{6,12}-[A-Z0-9]$`). Industry is range-checked against the SSIC seed when provided. Both run on create and update — the form is convenient, but the server is authoritative.
- **`/admin/clients` list + inline create form**. Live UEN preview: as the user types, the form re-runs the country's regex client-side and surfaces "Does not match expected format" inline + disables the Submit button until the format clears. The Submit button still posts to a server that re-validates — client preview is UX only.
- **`/admin/clients/[id]/edit`**. Same field set plus a Status select (Active / Draft / Archived). `ClientStatus` is mirrored as a literal-union type in the client component to keep `@prisma/client` out of the browser bundle (cut the page bundle from 18.4 kB → 2.04 kB).
- **Nav.** Admin header now leads with `Clients` ahead of the catalogue nav links.

**Decisions and rationale.**

1. **Reference data goes through tRPC, not direct DB calls in server components.** Two reasons. First, the create form is a client component (uses `useState` for form state), so it has to fetch via tRPC anyway. Second, having a single `referenceData` router gives later screens (S14 currency dropdown, S33 employee fk_lookup) a stable place to add to.
2. **UEN regex evaluated server-side, even though the input has a `pattern` attribute.** Browser pattern validation is for UX only — anyone with curl can hit the endpoint. Authoritative validation lives next to the row write.
3. **`industry` stays a free-form FK to `Industry.code`, not a strict relation.** v2 §6.1 says "Industry: dropdown from Global Reference: Industries (SSIC)" — but the SSIC code set evolves (2025 revision pending). A loose FK validated at the app layer lets us accept any seeded code today and migrate later without schema rewrites. Same model already used for `Client.countryOfIncorporation`.
4. **Email is `.nullable().or(z.literal(''))`.** Browsers submit empty form fields as `''`, not `undefined`. Without the literal-`''` branch, Zod fails the `.email()` check on what the user perceives as "I left this blank". Normalising to `null` at the schema boundary keeps the rest of the codebase simple.
5. **Don't import `ClientStatus` from `@prisma/client` in client components.** Prisma's runtime is server-only and pulling its type re-export drags ~16 kB of unrelated code into the page bundle. A 3-string literal union mirrors the enum at zero cost; the server route still validates via `z.nativeEnum(ClientStatus)`.

**Verification.**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` clean.
- New routes in build manifest: `/admin/clients` (2.52 kB), `/admin/clients/[id]/edit` (2.04 kB).
- Existing 11 unit tests still pass.

**Open items / next.**

- **S14 Policy + entities (Screen 2).** Add the Policy + PolicyEntity CRUD under a client. STM client requires three PolicyEntities each with own policy number. `rateOverrides` JSONB.
- **S15 Product selection (Screen 3).** First story that filters the insurer dropdown by ProductType.code matching `Insurer.productsSupported`.
- **S16 Catalogue seed scripts.** Seed the 12 default ProductTypes per v2 §3.5 with schemas, planSchemas, premiumStrategy refs, and Tokio Marine + Great Eastern parsing rules. Empty-state hint on `/admin/catalogue/product-types` will go away once this runs.
- **S17 Benefit year + draft state.** Auto-create the first BenefitYear in DRAFT when a Policy is created.

---

## 2026-04-27 — Phase 1B close-out (S10, S11, S12)

**Session focus.** Land the remaining three Phase 1B stories — Pool Registry, Employee Schema editor, Product Catalogue editor — and close the phase with a complete catalogue layer ready to feed Phase 1C client onboarding.

**What landed.**

- **S10 Pool Registry** — `/admin/catalogue/pools` list + create + edit. tRPC router under `apps/web/src/server/trpc/routers/pools.ts` with nested `PoolMembership` writes (Prisma's `members: { create: [...] }` on creation, `members: { deleteMany: {}, create: [...] }` on update — cleaner than diffing for the size we expect, ≤20 members per pool). Cross-tenant insurer validation via the same `assertInsurersBelongToTenant` pattern used in S9. Repeating-row member control with `insurerId` dropdown (disabled for already-selected rows so the same insurer can't be added twice) + `shareBps` integer input (0-10000 bps = 0-100%, null = unspecified). Shared `MemberRows` component between the create form and the edit form. Delete is a transactional two-step: wipe `PoolMembership` rows then delete the `Pool`.
- **S11 Employee Schema editor** — `/admin/catalogue/employee-schema` Screen 0a. Single-row-per-tenant `EmployeeSchema.fields` JSON array containing built-in + standard + custom fields, discriminated by `field.tier`. Three on-page sections: Built-in (read-only table), Standard (table with toggle column), Custom (table + form). Defaults for the 5 built-in + 5 standard fields live as constants in `packages/shared-types/src/employee-schema.ts`; `prisma/seed.ts` initializes the demo tenant's schema via `seedEmployeeSchemaForTenant`. Router enforces tier immutability: `setStandardEnabled` rejects non-STANDARD fields, `addCustom`/`updateCustom`/`removeCustom` reject non-CUSTOM fields. Custom-field name regex `^employee\.[a-z][a-z0-9_]*$` validated server-side. Schema version increments on every save for downstream consumers (S18 predicate builder + S33 employee CRUD will key cache invalidation off it). The "schema migration job" mentioned in v2 §8 S11 AC is a no-op in Phase 1B (no employee data exists yet); revisit when S33 adds employee CRUD.
- **S12 Product Catalogue editor** — `/admin/catalogue/product-types` list + `/admin/catalogue/product-types/new` + `/admin/catalogue/product-types/[id]/edit`. The list view is a thin row-per-type with Edit / Delete; create and edit share the same `ProductTypeForm` component. Code regex `^[A-Z][A-Z0-9_]*$`, premium strategy dropdown sourced from new `PREMIUM_STRATEGIES` constant in shared-types (5 codes per v2 §4). The four JSON fields (`schema`, `planSchema`, `parsingRules`, `displayTemplate`) use a reusable `JsonTextarea` component that parses on change and surfaces parse errors inline; the submit button stays disabled until all four parse. Version increments on every save. Delete handles P2003 foreign-key violations as a friendly "in use by one or more products" conflict, in anticipation of S15+ Product instances referencing ProductType.
- **Cross-package zod schema move.** Original draft of `customFieldSchema` lived in shared-types. tRPC's `.input(schema)` couldn't infer the parsed type because the workspace's two Prisma client extension types and shared-types' zod resolved to different brand registrations across pnpm boundaries. Fix: keep types + constants in shared-types; keep the Zod validator inline in the app's tRPC router. Documented at the top of `apps/web/src/server/trpc/routers/employee-schema.ts`.
- **Prisma JSONB null shape.** Setting a JSONB column to literal SQL `NULL` (vs JSON `null`) requires `Prisma.JsonNull` — passing raw `null` triggers a TypeScript `InputJsonValue` mismatch under strict mode. Both `parsingRules` and `displayTemplate` go through that adapter on create + update.
- **`exactOptionalPropertyTypes: true` strictness.** Zod-output types use `T | undefined` for `.optional()` fields, but our `EmployeeField` type uses `T?`. Spread-merging the Zod output into the target type fails. Fix: small `buildCustomField` helper that constructs the record key-by-key, only setting optional keys when present.
- **Nav links.** Admin layout now shows `Employee Schema · Product Types · Insurers · TPAs · Pools` in catalogue order.

**Decisions and rationale.**

1. **Visual schema editor for S12 is JSON textareas.** v2 §5.5 calls for "schema JSON (rendered as visual schema editor)". A real visual JSON Schema editor is multi-week UI work (drag-reorder fields, type-aware controls, conditional sub-form renderer). The S12 AC is "add a `maternity_rider` field, save, publish v2.5; downstream form renders the new field" — JSON textareas satisfy that AC fully because the downstream form (S15+) reads `schema` regardless of how it was authored. The editor surface gets revisited at S21 (per-product config) if it becomes the bottleneck. Captured in PROGRESS.md S12 deviation note.
2. **Pool memberships use delete-and-recreate on update.** Diffing 20 rows is more code than the simpler approach saves in DB round-trips. Prisma's nested `deleteMany: {}` + `create: [...]` runs in one transaction; the "lost ID" cost is zero because PoolMembership has no business identity outside (poolId, insurerId).
3. **Auto-create `EmployeeSchema` on first read, not on tenant creation.** The seed handles the demo tenant; new tenants in production get their schema lazily on first `employeeSchema.get` call. Saves a code path on tenant creation while preserving idempotence.
4. **`PREMIUM_STRATEGIES` and `TPA_FEED_FORMATS` belong in shared-types, not in seed scripts.** They're referenced from the UI dropdowns; centralising them avoids the "edit the seed AND the form constant" trap.
5. **Don't seed the 12 ProductTypes yet.** v2 §3.5 lists 12 default types but S16 (Phase 1C) is the seed-script story. S12 just builds the editor. The S12 list view shows an empty-state hint pointing at S16 — admins create them manually for now.

**Verification.**

- Three deploys all green: S10 in 24985014239, S11 in 24985474879 (queued and watched), S12 in 24985948194.
- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean across the workspace.
- Routes in the build manifest: `/admin/catalogue/employee-schema`, `/admin/catalogue/insurers`, `/admin/catalogue/pools`, `/admin/catalogue/product-types`, `/admin/catalogue/product-types/new`, `/admin/catalogue/product-types/[id]/edit`, `/admin/catalogue/tpas`, plus all the existing routes — 13 dynamic + 2 static.
- Live at staging; sign-in flow works; nav cycles through all five catalogue sections.

**Phase 1B status.**

| Story | Plan AC satisfied? | Note |
|---|---|---|
| S6 | ✅ | 249 countries, 9 currencies, 588 SSIC industries seeded live |
| S7 | ✅ | 6 operator library rows seeded live |
| S8 | ⚠️ partial | productsSupported half ✅; claimFeedProtocol deferred per ADR 0004 |
| S9 | ✅ | TPA registry with cross-tenant insurer validation |
| S10 | ✅ | Pool registry with member-insurer + share bps |
| S11 | ✅ | Built-in/standard/custom tiers, regex validation, version bumps |
| S12 | ⚠️ partial | All AC steps work; "rendered as visual schema editor" deferred to JSON textareas |

**Open items / next.**

- **Phase 1C — Client onboarding (S13-S17).** S13 Client CRUD (Screen 1, UEN validator), S14 Policy + entities, S15 Product selection (filtered insurer dropdown — first feature that actually consumes the registries we just built), S16 Catalogue seed scripts (the 12 default ProductTypes + Tokio Marine + Great Eastern parsing rules), S17 Benefit year + draft state.
- **S16 will retroactively populate the empty-state in S12's list view.** Once S16 lands, admins see all 12 ProductTypes pre-seeded.
- **Cross-tenant isolation test** still on the Definition of Done list. Add before any of S13-S15 since they introduce more tenant-scoped reads.
- **Visual JSON Schema editor for S21.** If Phase 1E reveals admins struggling with the textarea, build a proper visual editor as a S21 sub-task. Otherwise leave it.
- **WorkOS swap-back (ADR 0003)** still gated on a real prospect ask.

---

## 2026-04-27 — Phase 1A close-out + Phase 1B start (S3–S9, auth swap, theme)

**Session focus.** Push from S3 through S9 in one continuous session, deploy everything live to staging, swap the auth path so registry stories can be verified end-to-end without external SaaS provisioning, and apply a coherent design system across every surface.

**What landed (in commit order).**

- **S3 multi-tenancy + RLS** — `apps/web/src/server/db/tenant.ts` exports `requireTenantContext(userId)` which sets `app.current_tenant_id` via `set_config()` and returns a Prisma client extended via `$extends` to auto-inject `tenantId` on every CRUD operation against the 8 tenant-scoped models. Postgres RLS policies enforce the same isolation at the DB layer. tRPC's `tenantProcedure` builds on `protectedProcedure` and exposes `ctx.db`, `ctx.tenantId`, `ctx.userId`.
- **S4 schema migration applied to staging** — `prisma/migrations/20260427055126_initial_schema/` is the v2 schema (24 models). Applied to live Postgres Flexible Server B1ms. Seed creates the "Acme Brokers" demo tenant.
- **S5 BullMQ + Redis live** — `apps/web/src/server/jobs/` has the worker boot path, started from `instrumentation.ts`. `/api/health/redis` pings the live cache. Azure Cache for Redis Basic C0 deployed; `infra/bicep/modules/redis.bicep` carries an `AllowAzureServices` firewall rule (without it Container Apps gets ETIMEDOUT — Azure's "publicNetworkAccess: Enabled" alone is not sufficient). `redis://` URL uses the `rediss://` scheme for TLS on port 6380, with the password from `listKeys()` injected into the Container App secret bag at deploy time.
- **CI/CD auto-deploy** — `.github/workflows/ci.yml` gained a second job (`deploy → staging`) that runs after `ci` passes on `main`. Uses Azure OIDC (`azure/login@v2` with federated credentials, no static client secrets), `docker/build-push-action@v6` with GHA layer cache (`type=gha,mode=max`), and a fast-path detection: if no files under `infra/` changed since the previous push, run `az containerapp update --image` (~3-4 min); if infra changed, run the full Bicep deploy (~12-15 min). After the warm-cache state, a code-only push lands at 1m04s deploy time. The OIDC service principal `lts-github-oidc` (App ID `25589c75-967d-4d1c-8665-d0cad3002c59`) holds Contributor on `insurance-saas-staging-rg` only. GitHub repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `POSTGRES_ADMIN_PASSWORD`, `AUTH_SECRET` (later).
- **CI migrate + seed step** — same workflow runs `pnpm prisma migrate deploy && pnpm prisma db seed` against the live staging DB on every deploy. The DB URL is fetched at runtime from the Container App's `database-url` secret via `az containerapp secret show`, so we don't store it as a separate GitHub secret. Postgres has `AllowAzureServices` (0.0.0.0→0.0.0.0) on its firewall, which lets GitHub-hosted runners reach it without IP whitelisting per-run. Seeds are idempotent (upsert / `createMany skipDuplicates`) so running every deploy is safe.
- **Node 20 → Node 24 GHA actions** — added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` workflow-level env. Silences the deprecation warnings without waiting for each upstream action's major bump.
- **S6 Global Reference seeded live** — 249 ISO 3166-1 alpha-2 countries (SG with uenPattern, MY with SSM pattern), 9 currencies (SGD, USD, MYR, EUR, GBP, JPY decimals=0, CNY, HKD, AUD), 588 SSIC 2020 industry subclasses. `prisma/seeds/global-reference.ts` exposes three idempotent functions called from `seed.ts`. Verified via the migrate+seed CI step output: "[seed] countries: 249 upserted (249 total)".
- **S7 Operator Library seeded live** — 6 data type rows (string, integer, number, boolean, date, enum) per v2 §3.2. NUMBER_OPERATORS shared between integer/number to avoid duplication. `prisma/seeds/operators.ts`.
- **S8 Insurer Registry CRUD UI** — `/admin/catalogue/insurers` list + inline create form + `/admin/catalogue/insurers/[id]/edit`. tRPC router `apps/web/src/server/trpc/routers/insurers.ts` with `list`, `byId`, `create`, `update`, `delete`. Code regex `^[A-Z][A-Z0-9_]*$` for the unique-per-tenant code. Zod enum validation against the 12 product type codes shared from `packages/shared-types/src/catalogue.ts`. P2002 collisions surface as friendly `CONFLICT` errors. Originally shipped with a `claimFeedProtocol` dropdown; **dropped same day per ADR 0004** because nothing reads the column until S35.
- **S9 TPA Registry CRUD UI** — `/admin/catalogue/tpas` matching the S8 pattern. Cross-reference validation: every selected `supportedInsurerId` must exist in the same tenant's Insurer Registry, else `BAD_REQUEST`. `TPA_FEED_FORMATS = ['CSV_V1','CSV_V2','JSON_API','XLSX']` in shared-types — extend by editing one place. Note: Prisma names the all-caps `TPA` model as `tPA` on the client (camelCase from "TPA"); `ctx.db.tPA` not `ctx.db.tpa`.
- **Auth swap: WorkOS → Auth.js v5 Credentials** — see ADR 0003. New: `apps/web/src/server/auth/config.ts` (NextAuth config with Credentials provider, JWT sessions, our `tenantId` + `role` carried on the session via the jwt + session callbacks); `apps/web/src/app/api/auth/[...nextauth]/route.ts` (handler). Removed: `@workos-inc/authkit-nextjs` dep, `apps/web/src/app/api/auth/callback/route.ts`. Schema gained `User.passwordHash String?` (migration `20260427074432_add_user_password_hash`). Seed creates a dev admin (`admin@acme-brokers.local` / `admin123`, overridable via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Container App env vars: `AUTH_SECRET` (secretref), `AUTH_TRUST_HOST=true`, `AUTH_URL`. Tests (`env.test.ts`, `trpc-protected.test.ts`) updated for the new env vars and session shape.
- **Apple water glass design system** — `apps/web/src/app/globals.css` rewritten as a token-driven stylesheet on `:root` with utility classes: `.glass`, `.glass-strong`, `.card`, `.app-header` (sticky frosted nav), `.nav-link`, `.btn` (+ `-primary` / `-ghost` / `-danger` / `-sm`), `.input` / `.select` / `.textarea`, `.fieldset`, `.chip` group with `:has(input:checked)` highlight, `.table-wrap`, `.pill` (+ `-success` / `-accent` / `-muted`), `.eyebrow`, stack helpers. Aurora background painted on `body::before` with three radial gradients. Light-mode only; dark-mode tokens not yet defined. Re-skinned: sign-in page, admin layout (sticky glass header with nav + sign-out), admin home, S8 list + edit, S9 list + edit. All component-level color/border/shadow/radius now reference CSS variables — per the global CLAUDE.md rule.
- **`Insurer.claimFeedProtocol` removed** — see ADR 0004. Migration `20260427081919_drop_insurer_claim_feed_protocol`. The seed reference data in v2 §3.4 carries claim-feed values that we'll re-introduce when S35 lands and we know the actual parser-registry needs.

**Decisions and rationale.**

1. **Auth swap to Auth.js (ADR 0003).** Plan said WorkOS for SSO + MFA; the current need is "let me click around the registry UIs in the browser without external dashboard ceremony." Auth.js Credentials with bcrypt + JWT sessions delivers that in <200 lines. The `User.workosUserId` column stays in the schema as a forward-compat hook; the WorkOS code is deleted (git is the rollback path). Re-add trigger: first prospect that asks for SSO. ~4-6 hours estimated.
2. **`claimFeedProtocol` removed (ADR 0004).** The field has no functional consumer until S35. Asking admins to fill in "IHP / TMLS / DIRECT_API" today means they're guessing values that aren't tied to behaviour. Dropping the column is cleaner than carrying dead UI for 25 stories.
3. **CI/CD fast-path detection by `git diff --name-only ${{ github.event.before }} ${{ github.sha }} -- infra/`.** Falls back to full Bicep when `before` is the zero-SHA (first push). The 5x speedup on code-only pushes is what makes the seed-on-every-deploy step practical.
4. **Seeds run on every deploy, not as a one-shot.** Idempotent upserts mean the cost is one DB round-trip per row. Removes the "did someone remember to seed?" failure mode. If it grows expensive we can gate behind an env var; for now ~260 upserts is sub-second.
5. **Apple water glass theme as a single CSS file, not a component library.** Tailwind would be a bigger change than this stack needs; React component libraries (shadcn etc.) impose patterns we'd need to either follow or fight. Plain CSS variables + utility classes give us the visual polish without locking the rendering tree. The trade-off is you can't auto-complete class names; the JSX stays readable.
6. **Schema deviation captured as ADR, not as a TODO comment.** ADRs survive grep. TODO comments rot.

**Verification.**

- Every push since the auto-deploy job landed has gone green: code → CI → deploy in ~5-6 min cold, ~2 min warm.
- `pnpm typecheck && pnpm check && pnpm test && pnpm build` — clean across the workspace.
- Live URL: https://insurance-saas-staging-web.ambitiousisland-ce22282e.southeastasia.azurecontainerapps.io
- `/admin` redirects to `/sign-in` with `callbackUrl=%2Fadmin`. Signing in as `admin@acme-brokers.local` / `admin123` lands on the admin home and reveals tenant-scoped session data.
- `/admin/catalogue/insurers` and `/admin/catalogue/tpas` both render the glass UI; create/edit/delete round-trip works against staging Postgres.
- CI run logs show "[seed] countries: 249 upserted", "[seed] currencies: 9 upserted", "[seed] industries: 588 upserted", "[seed] operator library: 6 data type rows seeded", "[seed] dev admin: admin@acme-brokers.local".

**Open items / next.**

- **Phase 1B remaining: S10–S12.** Pool Registry (~clone of S9, smaller schema), Employee Schema editor (built-in/standard/custom field tiers), Product Catalogue editor (the most powerful screen — drives every form generated downstream). S10 first since it shares the chip-group pattern.
- **WorkOS swap-back (ADR 0003).** Triggered when a real prospect asks for SSO. The `User.workosUserId` column is already present.
- **Re-add `Insurer.claimFeedProtocol` at S35** per ADR 0004. Backfill plan TBD then — likely admin UI rather than data migration.
- **Dark mode tokens.** The `:root` CSS variables are designed for it (`color-scheme: light` is the only thing keeping it light-only). Add when there's a reason to.
- **Test coverage.** Per CLAUDE.md "no tests unless requested." The router-level cross-tenant isolation test promised in S3's plan AC remains the only outstanding test debt that the Definition of Done explicitly asks for; revisit before close-out.

---

## 2026-04-27 — Bicep gating: leanest staging stack

**Session focus.** During Azure portal setup, the user reviewed the projected ~S$60-70/mo idle cost of the full Phase 1 staging stack and asked which components were strictly necessary right now. Pruned the deploy down to the bare minimum needed to host a running container, with everything else gated behind opt-in flags that flip on as their stories land.

**Decision.** Default `staging.parameters.json` now deploys only **RG + ACR Basic + Container Apps env + Container App** — no Postgres, Redis, Storage, Key Vault, Log Analytics, or App Insights. Idle cost drops from ~S$60-70/mo to **~S$7/mo** (just the ACR Basic line item).

**Five gates added to `infra/bicep/main.bicep`** (all default `false`):

| Flag | Turns on | Cost delta | When to flip on |
|---|---|---|---|
| `deployPostgres` | Postgres Flexible Server B1ms | +S$25-30/mo | Story S4 (schema migrations) |
| `deployRedis` | Redis Basic C0 | +S$22/mo | Story S5 (BullMQ jobs) |
| `deployStorage` | Storage account + Blob | +S$0-2/mo | Story S29 (placement-slip uploads) — or revisit if SharePoint integration wins on the ADR |
| `deployObservability` | Log Analytics + App Insights | +S$0-5/mo | Production cutover; staging debugs via `az containerapp logs show --follow` |
| `deployKeyVault` | Key Vault Standard | +S$0-1/mo | Production cutover; Container Apps secret bag handles single-app needs |

**What changed in code.**

- `infra/bicep/main.bicep` — five new bool params, every optional module wrapped in `if (deployX)`, container-app and outputs reference conditional outputs via `deployX ? module.outputs.foo : ''`. Postgres password is now optional (default `''`) since it's only required when `deployPostgres=true`. Nine BCP318 "may be null" warnings on conditional-module access were each suppressed inline with `#disable-next-line BCP318` (the access is guarded by the same flag that controls the module — known-safe).
- `infra/bicep/modules/container-env.bicep` — `logAnalyticsCustomerId` / `logAnalyticsSharedKey` now optional. When both are empty, `appLogsConfiguration.destination` is set to `'none'` so the env runs without log shipping. Live debugging via `az containerapp logs show --follow` still works regardless of destination.
- `infra/bicep/modules/container-app.bicep` — `databaseUrl`, `redisUrl`, `appInsightsConnectionString` all default to `''`. Secrets and env vars are built via `concat()` of small per-feature arrays, so empty inputs cause the corresponding entry to be omitted entirely instead of showing up as a blank-valued env var inside the container.
- `infra/bicep/staging.parameters.json` — all five `deployX` flags set to `false`; placeholder Postgres password removed; left only `environmentName`, `location`, `appImage`, `postgresAdminUsername`, plus the five flags.
- `scripts/deploy-staging.sh` — adds a `jq` dependency to read `deployPostgres` from the parameters file; only requires `POSTGRES_ADMIN_PASSWORD` when that flag is true; passes the password parameter to Bicep only when needed.
- `infra/bicep/README.md` — restructured around the phased model. Cost summary table now distinguishes leanest (~S$7/mo), +Postgres (~S$37/mo), +Postgres+Redis (~S$59/mo), full (~S$65-70/mo).

**Why this beats committing to the full stack now.**

1. **Pay-as-you-build matches the story-by-story cadence.** Postgres sitting idle while we work on S2 (auth) and Phase 1B (registry CRUD UIs) burns ~S$30/mo for zero functional benefit — the schema isn't applied until S4.
2. **Cost reversibility is asymmetric.** Adding a flag is a one-line parameter change + redeploy. Removing a deployed Postgres requires a destructive operation and loses any data already there. Optimise for the cheaper direction.
3. **Production posture isn't being skipped, just deferred.** Observability + Key Vault are the right call for production but provide ~zero value during staging dev where I'm tailing logs in real time anyway. They flip on as part of the production cutover ADR (not yet written).

**Verification.**

- `az bicep build infra/bicep/main.bicep` — clean, zero warnings.
- `pnpm typecheck`, `pnpm check`, `pnpm test`, build — all clean.

**Open items / next.**

- **No Azure resources created yet.** The user asked to walk through provisioning step-by-step before anything is created. Step 1 (provider registration, free, async) is queued and waiting for explicit "go".
- **SharePoint vs Blob ADR (Story S29 prerequisite)** — when S29 lands, decide whether placement-slip ingestion uploads to Blob Storage (current Bicep path) or pulls from a SharePoint folder via Microsoft Graph. The latter would mean dropping `deployStorage` permanently and adding a Graph SDK + delegated app permissions instead. Captured here as a flag so we don't forget.

---

## 2026-04-27 — Story S2: WorkOS authentication

**Session focus.** Story S2 from `docs/PHASE_1_BUILD_PLAN_v2.md` §8: integrate WorkOS AuthKit for SSO + MFA, with `/admin` gated behind a session. Constraint: the WorkOS project is not yet provisioned externally (per the bootstrap log's first-week checklist), so the integration must boot cleanly with empty WorkOS env vars and fall back to a clear "auth not configured" UX rather than erroring or redirecting into a broken OAuth flow.

**What landed.**

- **AuthKit Next.js v4.0.1** added to `apps/web` (`@workos-inc/authkit-nextjs`). Pulls `@workos-inc/node@9.1.1`, `iron-session`, `jose`. ESM-only; works with the App Router.
- **`apps/web/src/server/env.ts`** — single source of truth for WorkOS env validation. Exports `isAuthConfigured()`, `assertAuthConfigured()`, `getAuthEnv()`, and `validateEnvOnBoot()`. Empty strings count as missing. Production startup throws on missing keys; development logs a warning and continues with auth disabled.
- **`apps/web/src/middleware.ts`** — Next.js edge middleware. When configured, delegates to `authkitMiddleware` with `/`, `/sign-in`, `/sign-up`, and `/api/trpc/*` marked as unauthenticated. When not configured, returns `NextResponse.next()` so the dev server still serves every route (the per-route components handle the disabled-state UX). Matcher excludes static assets and Next internals.
- **Auth routes:**
  - `apps/web/src/app/api/auth/callback/route.ts` — mounts `handleAuth({ returnPathname: '/admin' })`. Returns a 503 JSON when not configured.
  - `apps/web/src/app/sign-in/page.tsx` — generates a WorkOS sign-in URL via `getSignInUrl()` and redirects. Renders a help notice when not configured.
  - `apps/web/src/app/sign-out/route.ts` — calls `signOut({ returnTo: '/' })`. Redirects home when not configured.
- **Session helpers** at `apps/web/src/server/auth/session.ts` — `getSession()` returns `Session | null`, `requireSession()` throws a Next.js redirect to `/sign-in` if absent. The `Session` type carries `{ user: { id, email, firstName, lastName, roles }, accessToken }` — minimal shape, expanded in S3 with tenant id.
- **`/admin` shell** at `apps/web/src/app/admin/{layout,page}.tsx`. Layout calls `requireSession()` when auth is configured, otherwise renders an `AuthDisabledNotice` with a 4-step setup guide. Page shows the signed-in user's id/email/roles plus a "tenant scoping arrives in S3" note. Header has a `/sign-out` link.
- **tRPC context + protectedProcedure.** `apps/web/src/server/trpc/context.ts` is now async and calls `getSession()` to populate `ctx.session`. `apps/web/src/server/trpc/init.ts` adds a `protectedProcedure` built on a tRPC middleware that throws `TRPCError({ code: 'UNAUTHORIZED' })` when `ctx.session` is null and narrows the context type otherwise. `publicProcedure` is unchanged.
- **Tests** (`apps/web/tests/unit/`):
  - `env.test.ts` — 7 tests covering `isAuthConfigured`/`assertAuthConfigured`/`getAuthEnv` plus the dev-vs-prod behaviour of `validateEnvOnBoot`. Tests stash and restore `process.env` per test.
  - `trpc-protected.test.ts` — 2 tests confirming `protectedProcedure` throws UNAUTHORIZED with `ctx.session: null` and resolves with a populated session.
  - Existing `tRPC health` and `smoke` tests still pass (4 files, 11 tests total).
- **End-to-end smoke** with `pnpm start` against the auth-disabled build (no WorkOS env vars set):
  - `GET /` → 200, `health.ping` round-trip live on the page.
  - `GET /admin` → 200, renders "Admin disabled" notice (no redirect loop).
  - `GET /sign-in` → 200, renders "Sign-in unavailable".
  - `GET /api/trpc/health.ping` → 200 with the expected JSON shape.
- **`.env.example`** — WorkOS section rewritten with a 5-step setup checklist (dashboard project, API key, redirect URI registration, `openssl rand -base64 32` for the cookie password, SSO connection notes). Re-tagged from `[later — S3]` to `[now — S2]`.

**Decisions and rationale.**

1. **`/admin` as a literal path, not the `(admin)` route group.** The v2 plan and CLAUDE.md repo layout list `(admin)/` as a folder, which in Next.js App Router means a route group with no URL segment. Initial implementation followed that literally — placing the layout/page under `app/(admin)/` — and the resulting `/admin` URL returned 404 (the page rendered at `/`, conflicting with the home page). v2 §8 S2's AC explicitly says "log in to /admin", which is a real URL. Renamed to `app/admin/` as a literal folder. The `(admin)` notation in CLAUDE.md is treated as conceptual grouping; the URL `/admin` is the contract. Updated CLAUDE.md is unchanged for this — readers should understand the `(...)` is shorthand for "the admin shell, however we wire it".
2. **Auth-disabled fallback over hard-fail.** When `WORKOS_API_KEY` is empty, the SDK throws at module init. That would break local dev for anyone who hasn't yet completed the WorkOS dashboard setup. Three failure modes were considered:
   - hard-fail (production-grade safety, terrible local DX),
   - lazy init (defer SDK calls until needed, but still throws on the first `/admin` hit),
   - **gate-on-env-presence** (what we shipped — the SDK is only constructed when keys exist).
   Production is still safe because `validateEnvOnBoot()` throws when `NODE_ENV=production`. The fallback is a dev-only convenience, not a security weakening.
3. **Session payload narrowed at the boundary.** AuthKit's `withAuth()` returns ~10 fields; we expose `{ id, email, firstName, lastName, roles, accessToken }` only. Reasoning: future code shouldn't reach into the full WorkOS shape — additions to that shape should be deliberate Session-type additions, reviewed for PII (per v2 §7 PDPA constraints).
4. **`protectedProcedure` over an explicit `ensureSignedIn` flag.** Two-tier procedure helpers (public/protected) is the conventional tRPC pattern; future S3 work adds a third `tenantProcedure` that builds on `protectedProcedure` with `ctx.tenantId`. Prefer composable middleware to flag-driven dispatch.
5. **Sign-out as a GET route, not a server action.** Server actions need a form or `useFormState` boilerplate. A plain `<a href="/sign-out">` works without React state and matches AuthKit's documented pattern.
6. **Roles array, not a single role enum.** WorkOS supports both `role` (singular) and `roles` (multi). Our v2 schema's `User.role` is a single enum (TENANT_ADMIN / CATALOGUE_ADMIN / BROKER_ADMIN / CLIENT_HR / EMPLOYEE), but at the WorkOS layer the user may carry multiple org-level roles. Keeping the session as `roles: string[]` lets S3+ map "the WorkOS roles claim" to "our `User.role`" without re-shaping the session type.

**Verification.**

- `pnpm typecheck` — clean.
- `pnpm check` (Biome) — clean (38 files).
- `pnpm test` — 4 files, 11 tests pass.
- `pnpm build` — Next.js build succeeds. New routes in the manifest: `/admin`, `/sign-in`, `/sign-out`, `/api/auth/callback`. Middleware bundle: 94.4 kB.
- `az bicep build infra/bicep/main.bicep` — still clean.
- Live `pnpm start` smoke test — all four URLs respond as expected with auth disabled.

**Open items / follow-ups.**

- **WorkOS dev project provisioning** (still owed). One-time setup: dashboard project, AuthKit enabled, dev organisation created, Google + Microsoft SSO connections wired, redirect URI registered, four env vars copied into `.env`. Estimated 30–60 min. Once done, the same code paths above produce a working sign-in.
- **Real role mapping (S3 prerequisite).** Need to decide whether WorkOS roles map directly to `User.role` or whether we maintain a translation table. Captured as a discussion point for the S3 ADR.
- **MFA enrolment UX.** WorkOS handles the MFA flow inside its hosted UI — no code in this repo. The AC ("MFA prompt fires on first login") is satisfied by the WorkOS dashboard config; the code-side AC is just that we honour the resulting authenticated session.
- **Story S3 (multi-tenancy + Postgres RLS) is next.** It introduces `requireTenantContext()`, layers `tenantProcedure` on top of `protectedProcedure`, applies the v2 Prisma schema as the first real migration, and adds RLS policies + a cross-tenant isolation test.

---

## 2026-04-27 — Story S1: Repo + Bicep + CI/CD

**Session focus.** Story S1 from `docs/PHASE_1_BUILD_PLAN_v2.md` §8: complete the foundation layer. Bootstrap had already covered the monorepo and basic CI; this session adds tRPC, Azure Bicep templates, the Dockerfile, the staging deploy script, and the Bicep compile-check in CI.

**What landed.**

- **tRPC v11.16.0 wired up.** `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`, `superjson`, `zod` added to `apps/web`. Server scaffolding under `apps/web/src/server/trpc/`: `init.ts` (shared instance with superjson transformer), `context.ts` (placeholder Context type — populated in S2/S3), `router.ts` (root `appRouter` exporting `AppRouter` type), `routers/health.ts` (one `health.ping` query returning `{status: "ok", timestamp}`). Fetch-adapter handler at `apps/web/src/app/api/trpc/[trpc]/route.ts` exporting `GET` + `POST`. Browser-side hooks via `apps/web/src/lib/trpc/{client,provider}.tsx` using `httpBatchLink` and `superjson`. Provider wired into `app/layout.tsx`; the home page now renders the live `health.ping` round-trip status.
- **Vitest test for the router.** `apps/web/tests/unit/trpc-health.test.ts` invokes `appRouter.createCaller({session:null}).health.ping()` directly (no HTTP) and asserts `status: "ok"` plus an ISO-parseable timestamp. Both unit tests pass (`tests/unit/smoke.test.ts` + the new one).
- **Bicep stack under `infra/bicep/`.** `main.bicep` composes eight modules (Log Analytics, App Insights, ACR, Container Apps env, Container App, Postgres Flexible Server, Redis, Storage, Key Vault) all pinned to `southeastasia`. Deterministic naming via `uniqueString(resourceGroup().id)` for globally-unique resources. Outputs: `appUrl`, `postgresFqdn`, `keyVaultUri`, `registryLoginServer`, `blobEndpoint`. Compiles clean (`az bicep build`, no warnings).
- **`infra/bicep/staging.parameters.json`** — placeholder password and image references; both replaced at deploy time by the script.
- **Production `Dockerfile`** at repo root — multi-stage (deps → build → run) building the Next.js standalone bundle. `ARG NODE_VERSION=20.18.1`, `ARG PNPM_VERSION=9.15.4`. `.dockerignore` excludes `node_modules`, `.next`, `tests`, `reference`, lockfiles in nested paths.
- **`next.config.mjs` standalone gating.** `output: 'standalone'` is now conditional on `STANDALONE_BUILD=true` env var. Reason: standalone tracing creates symlinks under `.next/standalone/node_modules/`, which on Windows requires Developer Mode or admin (EPERM otherwise). The Dockerfile sets `STANDALONE_BUILD=true`; local `pnpm build` on Windows now succeeds without it.
- **`scripts/deploy-staging.sh`** — bash, idempotent. Validates `az login`, ensures resource group, on first run bootstraps infra with a placeholder image (since ACR doesn't exist yet), then builds + pushes the real image and redeploys. Reads `POSTGRES_ADMIN_PASSWORD` from env (intentionally not in the parameter file). Prints final `appUrl`. Marked executable.
- **`.github/workflows/ci.yml`** — added an `az bicep build` compile-check step after `pnpm build`. CI now: install → biome check → typecheck → test → build → bicep compile.
- **`infra/bicep/README.md`** — module map, SKU rationale (B1ms Postgres, Basic C0 Redis, Basic ACR, Standard LRS Storage), cost estimate, what's deferred to Phase 2 (private endpoints, multi-env params, what-if checks).

**Decisions and rationale.**

1. **tRPC v11 not v10.** v11 is the current stable line and matches Next.js 15 App Router patterns better (fetch adapter, `httpBatchLink` with transformer per-link rather than per-instance). No v10 lock-in to preserve since this is a greenfield session.
2. **Two procedure files (`router.ts` + `routers/health.ts`).** Keeps `router.ts` small and readable as the catalogue grows. v2 §0 read-order conventions favour discoverable directories over single mega-files; this lays the directory shape early.
3. **Standalone build gated, not removed.** v2 §13 Definition of Done assumes a deployable container image. Standalone is the right output for that — it ships a 100 MB image instead of 800 MB. Gating it on `STANDALONE_BUILD=true` rather than removing it preserves the deploy path while unblocking Windows local development. The other option (mandate Windows Developer Mode) would create a tooling cliff for any future Windows contributor.
4. **`outputFileTracingRoot` via `path.resolve(fileURLToPath(...), '../..')`.** First attempt used `new URL('../..', import.meta.url).pathname` which produces `/C:/Users/huien/LTS/` on Windows — Next.js then created a top-level `Users/huien/LTS/` directory at the repo root during build. Cleaned up the polluted folder, replaced with the correct `node:url` + `node:path` conversion. This is documented in `next.config.mjs` for the next person who hits it.
5. **ACR admin user enabled, not managed identity.** Phase 1 deploys from a developer laptop with `az login`; managed-identity image pulls require a CI service principal which doesn't exist yet (owed by the human, per bootstrap log). Switching to MI is a one-line change in `container-app.bicep` once the SP lands — captured in the README's "deferred" list.
6. **Postgres + Redis connection strings exposed as Bicep outputs.** Bicep linter flags this as a secret-leak risk, but the outputs flow only into another module's `@secure()` parameter for the Container App secret bag — never to a user-facing surface. Suppressed with `#disable-next-line outputs-should-not-contain-secrets` on the specific output lines, with no project-wide rule disablement.
7. **No actual Azure deployment this session.** Three of S1's exit criteria are deploy-time (resource group, container revisioning, end-to-end smoke). Those are gated on the Azure subscription + service-principal setup that's still owed externally. The script and templates are validated by `az bicep build`; the live deploy is the first thing to run once the subscription is in place. PROGRESS.md ticks S1 with a footnote rather than waiting on external dependencies before recording progress.

**Verification.**

- `pnpm typecheck` — clean.
- `pnpm check` (Biome lint + format + organizeImports) — clean.
- `pnpm test` — 2 tests pass (smoke + tRPC health).
- `pnpm build` — Next.js production build succeeds. `/api/trpc/[trpc]` correctly registered as a dynamic route.
- `az bicep build --file infra/bicep/main.bicep` — compiles with zero warnings.

**Open items / follow-ups.**

- **Azure subscription + RG + service principal** (still owed by the human). Once provisioned, run `./scripts/deploy-staging.sh` and confirm the resulting app URL serves `/api/trpc/health.ping`.
- **WorkOS project + dev organisation + dev Key Vault** (still owed). Story S2 uses these.
- **CI enhancement deferred:** add Azure login + bicep what-if step to a separate `infra-validate` workflow once the staging SP lands.
- **Story S2 (WorkOS auth) is next.** It populates `apps/web/src/server/trpc/context.ts` with the session, replaces the `(auth)` route group placeholder, and gates `/admin` behind `requireSession()`.

---

## 2026-04-27 — v1 → v2 plan migration

**Session focus.** Adopt `docs/PHASE_1_BUILD_PLAN_v2.md` as the canonical Phase 1 plan and reconcile the existing repo state with it. The bootstrap session left a v1-shaped `prisma/schema.prisma` (Agency/agencyId, four JSON Schemas per ProductTypeVersion, no registries, no EmployeeSchema, no stacked plans). v2 demands Tenant/tenantId, two schemas + premiumStrategy, six metadata registries, EmployeeSchema, Pool/PoolMembership, TPA, BenefitYear (replacing PolicyVersion), PolicyEntity (replacing PolicyHoldingEntity, with `rateOverrides`), and Plan additions for stacks/flex/effective dates. No migrations had been generated, so the swap is purely text.

**What landed.**

- `prisma/schema.prisma` — full replacement against v2 §2. Models: Tenant, User, Country, Currency, Industry, EmployeeSchema, OperatorLibrary, Insurer, TPA, Pool, PoolMembership, ProductType, Client, Policy, BenefitYear, PolicyEntity, BenefitGroup, Product, Plan (with `stacksOn` self-relation, `selectionMode`, `effectiveFrom/To`), ProductEligibility, PremiumRate, Employee, Dependent, Enrollment, AuditLog, PlacementSlipUpload. `pnpm prisma format` and `pnpm prisma generate` both pass.
- `CLAUDE.md` — Agency→Tenant terminology (`requireAgencyContext` → `requireTenantContext`, `agency_id` → `tenantId`, audit context wording). New "Phase 1 plan (canonical)" section pointing to v2 as the source of truth and listing the session-start read order. "Things that will probably confuse you" rewritten: 4 schemas → 2 schemas + premiumStrategy; new entry on the six registries; hierarchy updated to Tenant > Client > Policy > BenefitYear > Product.
- `docs/build_brief.md` — top-of-file banner marking it superseded by v2. Kept in repo for traceability rather than deleted.
- `docs/PROGRESS.md` — new file, 35-story checklist organised by phase 1A–1H, plus the Three Clients acceptance test and Definition of Done from v2 §13. Bootstrap session and this migration session ticked.
- `docs/ADRs/0001-metadata-driven-architecture.md` — captures the three-tier model and six registries (status: Accepted).
- `docs/ADRs/0002-stacked-plans-and-flex-mode.md` — captures `Plan.stacksOn`, `selectionMode`, `effectiveFrom/To`, and `PolicyEntity.rateOverrides` (status: Accepted).
- `reference/README.md` — created. Lists the three placement slips and Inspro screenshots, points at v2 plan as required reading before catalogue/parser/seed work.
- `prisma/seed.ts` — comment updated to point at v2 stories (S6/S7/S11/S16) instead of the old "S8" reference.
- `README.md` — Documents section now leads with v2 plan + PROGRESS.md + ADRs; build_brief.md flagged as superseded. Status line updated to "bootstrap + v2 migration complete; Story S1 next".
- `.env.example` — story references retargeted (Redis used by S5 not S20; WorkOS by S2 not S3; Blob by S29 not S17).

**Decisions and rationale.**

1. **Replace v1 schema rather than archive it.** Git history preserves the v1 schema (commit `b7e67a8` and earlier). Keeping a parallel v1 file in the tree adds no value once v2 is canonical; the build brief banner is enough traceability. The v1 schema didn't touch a single migration so no rollback path is being lost.
2. **Faithful translation of v2 §2 with three minor Prisma corrections.** v2 wrote enums in pipe-delimited form (`enum X { A | B | C }`) which is invalid Prisma syntax — translated to multiline. Added `@db.Decimal(12,4)` / `@db.Decimal(14,2)` precision on `PremiumRate.ratePerThousand` / `fixedAmount` (v2 left them as plain `Decimal?`). Added `onDelete: NoAction, onUpdate: NoAction` on the `Plan.riderOf` self-relation to satisfy Prisma's referential-action requirement on optional self-relations.
3. **Two ADRs at status `Accepted`, not `Proposed`.** v2 §12 explicitly mandates these as part of the migration, and the decisions are baked into the schema we just wrote. Marking them `Proposed` would imply the schema is provisional, which it isn't.
4. **`build_brief.md` kept, not deleted.** It documents the historical brief that the bootstrap session was working from and is referenced from the bootstrap log entry. Deleting it would orphan that reference. The top banner makes precedence unambiguous.
5. **No reference to deleted v1 entities (Agency, PolicyVersion, PolicyHoldingEntity, ProductTypeVersion) anywhere in the new docs.** Scrubbed CLAUDE.md, README.md, and seed.ts. Only `docs/build_brief.md` (now banner-marked) and `docs/architecture.md` (untouched supporting context) still use the old names.
6. **Story renumbering.** v1 had 26 stories (S1–S26) keyed off the build brief; v2 has 35 (S1–S35). The numbers do not align. PROGRESS.md uses v2 numbering; the bootstrap log entry's "Story S1 is next" still makes sense because v2 S1 is also infrastructure-flavoured (Bicep + remaining CI/CD), with the existing CI workflow already covering the GitHub Actions piece.

**Verification.**

- `pnpm prisma format` — clean.
- `pnpm prisma generate` — generates client successfully against v2 schema.
- `pnpm typecheck` — clean.
- `pnpm check` — clean after the line-ending fix below.
- `pnpm test` — 1 smoke test passes.
- `pnpm build` — Next.js production build succeeds.

**Line-ending fix (incidental, but in this commit).** Biome was failing locally with 17 CRLF-vs-LF errors on files Biome had not generated. Root cause: Git's `core.autocrlf=true` on Windows converts LF→CRLF in the working tree, while `biome.json` enforces `lineEnding: "lf"`. The bootstrap session reported a clean `pnpm check` because formatting was applied right before commit; the staleness only surfaces on subsequent invocations. Two-part fix: (a) added `.gitattributes` with `* text=auto eol=lf` plus `binary` markers for `.xls`/`.xlsx`/`.png` and `-text` for lockfiles, so future checkouts on any OS land as LF; (b) ran `pnpm exec biome check --write .` to normalise the existing working tree (17 files touched, all whitespace/EOL only — no semantic diff). Files affected are pre-existing bootstrap files plus a few I edited in this session.

**Open items / follow-ups.**

- Run full local check suite (`pnpm typecheck && pnpm check && pnpm test && pnpm build`) before pushing.
- Story S1 next session: add `infra/bicep/` Bicep templates for Azure Container Apps + Postgres Flexible Server + Redis + Blob + Key Vault + App Insights, and `scripts/deploy-staging.sh`. The existing `.github/workflows/ci.yml` already covers the green-CI half of S1's AC.
- First-week external setup still owed (per bootstrap entry): Azure subscription + resource group, WorkOS project + dev organisation, dev Key Vault.

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
- `.github/workflows/ci.yml` — lint + format check (Biome) + typecheck + tests + build, on every push to `main` (PR triggers removed when the workflow flipped to direct-to-main pushes). Uses pnpm cache via `actions/cache@v4`.
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
