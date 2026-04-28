# Phase 1 — Story Progress

Live tracker for the 35 stories in `docs/PHASE_1_BUILD_PLAN_v2.md` §8. Tick the box on the same commit that lands the story. The progress log (`docs/progress-log.md`) carries the per-session narrative; this file is the at-a-glance status board.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (link to issue/ADR)

---

## Phase status

| Phase | Stories | State | Notes |
|---|---|---|---|
| **1A** Foundation | S1–S5 | ✅ complete | S2 shipped Auth.js Credentials, not WorkOS — see ADR 0003 |
| **1B** Registries / Screen 0 | S6–S12 | ✅ complete | S8 has a documented field deferral (ADR 0004); visual schema editor for S12 deferred to JSON textareas — see story note |
| **1C** Client onboarding | S13–S17 | ✅ complete | Built S13 → S14 → S17 → S16 → S15 (re-sequenced for FK dependencies) |
| **1D** Predicate builder | S18–S20 | 🔄 in progress | S18 landed |
| **1E** Per-product config | S21–S25 | ⏳ not started | |
| **1F** Review + publish | S26–S28 | ⏳ not started | |
| **1G** Excel ingestion | S29–S32 | ⏳ not started | |
| **1H** Employees + claims | S33–S35 | ⏳ not started | S35 also re-adds `Insurer.claimFeedProtocol` per ADR 0004 |

## Documented deviations from v2 plan

These are conscious, recorded deviations — each has an ADR and a re-add trigger:

| Deviation | Decided | ADR | Re-add when |
|---|---|---|---|
| Auth: WorkOS → Auth.js Credentials | 2026-04-27 | [ADR 0003](ADRs/0003-auth-path-deferred-workos.md) | First prospect asks for SSO, or MAS TRM compliance review |
| `Insurer.claimFeedProtocol` removed | 2026-04-27 | [ADR 0004](ADRs/0004-defer-claim-feed-protocol.md) | S35 (claims feed pipeline) |

---

## Pre-stories

- [x] Bootstrap — repo + tooling + Next.js scaffold + dev-setup + CI (2026-04-25, see `progress-log.md`)
- [x] v1 → v2 migration — schema, CLAUDE.md, ADRs 0001/0002, this file (2026-04-27)

---

## Phase 1A — Foundation (S1–S5) ✅

- [x] **S1** Repo + Bicep + CI/CD — Next.js + Prisma + tRPC monorepo, Azure Bicep templates for Container Apps, GitHub Actions pipeline. (2026-04-27 — deployed live at https://insurance-saas-staging-web.ambitiousisland-ce22282e.southeastasia.azurecontainerapps.io; auto-deploy + Docker layer cache landed same day in `.github/workflows/ci.yml`)
- [x] **S2** Auth — code landed and verified end-to-end. (2026-04-27 — Auth.js v5 Credentials provider per ADR 0003; WorkOS path deferred. Plan AC for SSO + MFA is **not satisfied** by current implementation; tracked as a known gap until the swap-back.)
- [x] **S3** Multi-tenancy middleware + RLS — Postgres RLS on every tenant-scoped table; middleware sets `app.current_tenant_id`. Cross-tenant query returns 0 rows. (2026-04-27 — RLS policies applied to staging; `requireTenantContext()` + Prisma `$extends` auto-inject tenantId on all 8 tenant-scoped models)
- [x] **S4** Database baseline + Prisma schema — apply v2 schema. `prisma migrate deploy` clean; seed script creates one demo tenant. (2026-04-27 — migration `20260427055126_initial_schema` applied to staging Postgres; `seed.ts` creates "Acme Brokers" demo tenant + dev admin user via upsert)
- [x] **S5** Background job queue (BullMQ + Redis) — sample `hello-world` job dispatched and processed; Redis health check at `/api/health/redis`. (2026-04-27 — BullMQ worker + ioredis in `apps/web/src/server/jobs/`; started via `instrumentation.ts`; Azure Cache for Redis Basic C0 deployed to staging; `/api/health/redis` pings live Redis)

## Phase 1B — Registries / Screen 0 (S6–S12) ✅

- [x] **S6** Global Reference seeding — Country (249), Currency (9), Industry (588 SSIC 2020 subclasses). (2026-04-27 — `prisma/seeds/global-reference.ts`; SG has uenPattern `^[0-9]{8,10}[A-Z]$`, MY has SSM pattern; seed runs via `pnpm prisma db seed`, applied automatically on every deploy by the CI/CD migrate+seed step)
- [x] **S7** Operator Library seeding — `OperatorLibrary` per v2 §3.2. 6 data type rows (string, integer, number, boolean, date, enum). (2026-04-27 — `prisma/seeds/operators.ts`)
- [x] **S8** Insurer Registry CRUD UI — Screen 0b. (2026-04-27 — `/admin/catalogue/insurers` list + inline add form + edit page; `insurers` tRPC router with list/byId/create/update/delete via `tenantProcedure`. **Deviation:** `claimFeedProtocol` removed per ADR 0004 — re-add at S35. Plan AC's productsSupported half is satisfied; the claimFeedProtocol half is the documented deferral.)
- [x] **S9** TPA Registry CRUD UI — Screen 0c. (2026-04-27 — `/admin/catalogue/tpas` list + inline add form + edit page; `tpas` tRPC router with cross-reference validation against insurer registry. Apple water glass theme + CSS variable design system landed in the same commit and applies retroactively to S2/S8 surfaces.)
- [x] **S10** Pool Registry CRUD UI — Screen 0d. (2026-04-27 — `/admin/catalogue/pools` list + inline add form + edit page; `pools` tRPC router with nested `PoolMembership` writes (delete-and-recreate on update, transactional delete) and cross-tenant insurer validation. Repeating-row member control with insurer dropdown + share basis points; shared `MemberRows` component between create and edit forms.)
- [x] **S11** Employee Schema editor — Screen 0a. (2026-04-27 — `/admin/catalogue/employee-schema` with three sections: built-in (read-only), standard (toggle on/off), custom (CRUD). Defaults for 5 built-in + 5 standard fields live in `packages/shared-types/src/employee-schema.ts`; seed bootstraps the demo tenant's schema. Router enforces tier immutability at the API level; name regex `^employee\.[a-z][a-z0-9_]*$` validated server-side via Zod (kept in app-side router to avoid cross-package zod brand collision). Schema version increments on every save for downstream consumers (S18 predicate builder + S33 employee CRUD will key cache invalidation off it). Saving currently doesn't trigger a separate "schema migration job" — none is needed in Phase 1B since no employee data exists yet; revisit at S33.)
- [x] **S12** Product Catalogue editor — Screen 0e. (2026-04-27 — `/admin/catalogue/product-types` list + create + edit; `productTypes` tRPC router with full CRUD, version increments on every save, P2003 foreign-key violations surface as friendly conflicts. JSON textareas (with parse-on-change validation) for `schema` / `planSchema` / `parsingRules` / `displayTemplate`. Premium strategy dropdown from new `PREMIUM_STRATEGIES` constant in shared-types. **Deviation:** v2 §5.5 calls for "rendered as visual schema editor" — that's a multi-week UI build; Phase 1B ships JSON textareas which fully satisfy the AC ("add a `maternity_rider` field, save, publish v2.5; downstream form renders the new field") because the downstream form (S15+) reads `schema` regardless of how it was authored. Visual schema editor revisited at S21 if needed. **Publish workflow:** version-bumps on save are immediate; immutable published-version snapshots arrive with S28 per v2 §5.5 "publish gate".)

## Phase 1C — Client onboarding setup (S13–S17)

- [x] **S13** Client CRUD (Screen 1) — broker admin adds Balance Medical with country=SG, UEN validator passes. (2026-04-28 — `/admin/clients` list + inline create form + edit page; `clients` tRPC router with full CRUD, server-side UEN validation against `Country.uenPattern`, FK-style validation against `Industry.code`. New `referenceData` router exposes Country/Currency/Industry queries via `protectedProcedure` since those tables aren't tenant-scoped. Client-side UEN regex preview with disabled-submit until the pattern clears; email field tolerates empty string and normalises to null. `ClientStatus` mirrored as literal union in client to keep Prisma out of browser bundle.)
- [x] **S14** Policy + entities (Screen 2) — STM client has 3 PolicyEntities each with own policy number; `rateOverrides` JSONB accepts null and sample override. (2026-04-28 — `/admin/clients/[id]/policies` list + create + edit at `/admin/clients/[id]/policies/[policyId]/edit`; `policies` tRPC router with full CRUD, optimistic locking via `expectedVersionId`, `assertClient` tenant gate (Policy is reached through Client, not directly tenant-scoped). PolicyEntity rows managed via delete-and-recreate inside a transaction; one-master invariant + per-policy unique policyNumber enforced server-side. `rateOverrides` JSONB editor uses parse-on-change textarea with inline JSON errors; empty text → `Prisma.JsonNull`, valid object → JSONB, invalid blocks save. Client list table grew a "Policies" deep-link.)
- [x] **S15** Product selection (Screen 3) — Insurer dropdown filtered by `productsSupported` matching the row's product type; CUBER saves with 10 products spanning Tokio Marine + Zurich + Allied World. (2026-04-28 — `products` tRPC router with listByBenefitYear/create/update/delete; server-side `assertInsurerSupportsProductType` enforces that `Insurer.productsSupported` includes the chosen `ProductType.code` regardless of UI. New page at `/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/products` with cascading dropdowns: pick ProductType → eligible insurers auto-filter; if you swap ProductType after picking an insurer, the insurer clears if it no longer supports the new type. Pool + TPA optional, both filtered to active tenant rows. Editable only on DRAFT BenefitYears (PUBLISHED is read-only). `Product.data` is left as `{}` — Screen 5a (S21) fills in actual fields.
- [x] **S16** Catalogue seed scripts — seed all 12 ProductTypes per v2 §3.5 with schemas, planSchemas, premiumStrategy refs, and Tokio Marine + Great Eastern parsing rules. `pnpm seed:catalogue` populates 12 rows; GHS planSchema includes `stacksOn` and `selectionMode`. (2026-04-28 — `prisma/seeds/product-catalogue.ts` exports `PRODUCT_TYPE_SEEDS` (12 types: GTL/GCI/GDI/GPA/GHS/GMM/FWM/GP/SP/Dental/GBT/WICI) and `seedProductCatalogueForTenant`. Each entry carries product schema, planSchema (with stacksOn + selectionMode + effective dates), premiumStrategy, parsingRules (TM_LIFE + GE_LIFE templates only at seed time), and a minimal displayTemplate. New `pnpm seed:catalogue` runs against every tenant in the DB. Folded into `prisma/seed.ts` so CI/CD's `prisma db seed` step populates on next deploy. Defensive drift check throws if `PRODUCT_TYPE_CODES` and `PRODUCT_TYPE_SEEDS` desync.
- [x] **S17** Benefit year + draft state — creating a Policy auto-creates the first BenefitYear in DRAFT; only admin can transition to PUBLISHED. (2026-04-28 — `benefitYears` tRPC router with listByPolicy/byId/create/updateDates/setState. `policies.create` now spawns a 12-month DRAFT BenefitYear alongside the Policy. State graph DRAFT → PUBLISHED → ARCHIVED enforced server-side; `setState` to PUBLISHED or archiving a PUBLISHED year is gated to TENANT_ADMIN/BROKER_ADMIN; publish stamps `publishedAt`/`publishedBy`. PUBLISHED years are immutable — `updateDates` rejects them. `BenefitYearsSection` component on the policy edit page surfaces the list with Edit dates / Publish / Archive controls. **Reordered ahead of S15/S16** — Product needs benefitYearId so S17 had to land first; S15 (Product selection) follows next.

## Phase 1D — Predicate builder / Screen 4 (S18–S20)

- [x] **S18** Predicate builder reading EmployeeSchema dynamically — opening Screen 4 for a tenant with `hay_job_grade` (custom) shows it in the field dropdown; selecting populates operator dropdown with integer operators; value is a number bounded by schema min/max. (2026-04-28 — `benefitGroups` tRPC router with structural JSONLogic validation via `json-logic-js.apply` against `{}`. New `/admin/clients/[id]/policies/[policyId]/benefit-groups` page with field/operator/value triplet rows + AND/OR connector, repeating rows for compound predicates, edit-existing flow that round-trips JSONLogic back to the UI. Field dropdown reads `EmployeeSchema.fields` filtered by `selectableForPredicates && (tier !== STANDARD || enabled)`. Operator dropdown sourced from new `referenceData.operators` query backed by `OperatorLibrary`. Value control switches per data type: number with min/max for integer/number; date input for date; select for enum; boolean toggle; multi-select chips for `in/notIn` over enums; comma-separated input for `in/notIn` over text/numbers; range inputs for `between`. JSONLogic round-trip helpers in `apps/web/src/lib/predicate.ts`.
- [ ] **S19** Live employee match preview — typing a predicate and waiting <500ms shows matching count; preview re-evaluates on schema field changes.
- [ ] **S20** Overlap detection on save — saving two benefit groups with intersecting predicates surfaces a warning; user can acknowledge and save; intersection check is JSONLogic-aware.

## Phase 1E — Per-product config / Screen 5 (S21–S25)

- [ ] **S21** Product details sub-tab (5a) — fields rendered from `ProductType.schema`; GHS shows different fields than GTL; required fields enforce.
- [ ] **S22** Plans sub-tab (5b) with stacksOn and selectionMode — STM GTL has 4 plans; Plan C has `stacksOn=Plan B`; eligibility engine applies both Plan B and Plan C cover to a matching employee in dry-run.
- [ ] **S23** Eligibility matrix sub-tab (5c) — matrix renders N benefit groups × M plans; saving creates ProductEligibility rows; missing assignments flagged on Screen 6.
- [ ] **S24** Premium calculation sub-tab (5d) with strategy library — GHS uses `per_group_cover_tier`; CUBER GHS computes 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948 within ±$1.
- [ ] **S25** Effective-dated benefit schedules — Plan can have `effectiveFrom` mid-year; eligibility engine and premium calc respect the boundary.

## Phase 1F — Review + publish / Screen 6 (S26–S28)

- [ ] **S26** Review summary view — Three Clients render correctly: Balance shows 4 cards, CUBER 10, STM 7; each card has Edit deep-link.
- [ ] **S27** Validation engine — STM with stacked plans missing `stacksOn` raises a Blocker; mid-year period change raises a Warning; clean Balance setup raises 0 issues.
- [ ] **S28** Draft → publish workflow with optimistic locking — concurrent edits to the same Policy raise 409 on the second save; publishing creates an immutable BenefitYear snapshot.

## Phase 1G — Excel ingestion (S29–S32)

- [ ] **S29** Upload + parser registry — POST a placement slip XLS to `/imports`; classify by insurer template; queue parse job. Balance Medical classifies as Tokio Marine.
- [ ] **S30** Tokio Marine template parser — parse Balance + CUBER. Balance produces 4 products with correct premiums (~$4,143 total); CUBER produces 10 products (~$8,275).
- [ ] **S31** Great Eastern template parser — parse STM. 7 products, 6 benefit groups (4 with compound predicates), 3 PolicyEntities.
- [ ] **S32** Parser review screen with issue resolution — STM parse surfaces "Plan C/D needs stacksOn — choose base plan" as resolvable; user picks Plan B for Plan C; passes Screen 6.

## Phase 1H — Employees + claims (S33–S35)

- [ ] **S33** Employee admin CRUD against tenant EmployeeSchema — adding an STM employee with `hay_job_grade=8`, `work_pass_type=WORK_PERMIT` auto-matches "Foreign Workers WP/SP HJG 08-10" group.
- [ ] **S34** CSV import of employees — CSV columns map to EmployeeSchema fields by header; rows failing validation surface for fix; successful rows create Employee records.
- [ ] **S35** TPA claims feed (IHP) — sample IHP claim feed CSV ingested; Enrollment lookups match claims to employees + plans; unmatched claims flagged. **Also re-introduces `Insurer.claimFeedProtocol`** per ADR 0004.

---

## Three Clients acceptance test (v2 §9)

When all 35 stories are done, this end-to-end test must pass:

- [ ] Balance Medical — 4 products (GTL, GHS, GPA, WICI), 0 blockers, 0 warnings, publishes; portal shows 3 enrolled employees on GHS Plan 1 EO.
- [ ] CUBER AI — 10 products, 1 GBT cover-basis warning (acknowledgeable), publishes; portal shows 5 enrolled employees on the correct plans.
- [ ] [REDACTED] — 7 products, 6 benefit groups (4 compound), Plan C/D rider stacks, 3 PolicyEntities, 0 blockers; portal shows a Foreign Worker on GHS Plan 5 + GTL Plan B.

## Definition of done (v2 §13)

- [ ] All 35 stories landed behind green CI.
- [ ] Three Clients scenarios all pass.
- [ ] SEC-001 through SEC-010 (v2 §7) implemented with integration tests. **SEC-001 (MFA) blocked by ADR 0003** — closes when WorkOS is re-added.
- [ ] A new client (CUBER-complexity) can be onboarded end-to-end in <30 min through the UI alone.
- [ ] A catalogue admin can add a new ProductType in-session with no deploy.
- [ ] Cross-tenant isolation has a passing test.
