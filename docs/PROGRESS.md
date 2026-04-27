# Phase 1 — Story Progress

Live tracker for the 35 stories in `docs/PHASE_1_BUILD_PLAN_v2.md` §8. Tick the box on the same commit that lands the story. The progress log (`docs/progress-log.md`) carries the per-session narrative; this file is the at-a-glance status board.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (link to issue/ADR)

---

## Pre-stories

- [x] Bootstrap — repo + tooling + Next.js scaffold + dev-setup + CI (2026-04-25, see `progress-log.md`)
- [x] v1 → v2 migration — schema, CLAUDE.md, ADRs 0001/0002, this file (2026-04-27)

---

## Phase 1A — Foundation (S1–S5)

- [x] **S1** Repo + Bicep + CI/CD — Next.js + Prisma + tRPC monorepo, Azure Bicep templates for Container Apps, GitHub Actions pipeline. (2026-04-27 — deployed live at https://insurance-saas-staging-web.ambitiousisland-ce22282e.southeastasia.azurecontainerapps.io)
- [x] **S2** Auth via WorkOS — SSO + MFA. (2026-04-27 — code landed; live SSO + MFA gated on WorkOS dev project provisioning. App boots in "auth disabled" mode without keys; `/admin` and `/sign-in` render help notices instead of erroring.)
- [x] **S3** Multi-tenancy middleware + RLS — Postgres RLS on every tenant-scoped table; middleware sets `app.current_tenant_id`. Cross-tenant query returns 0 rows; integration test confirms isolation. (2026-04-27 — RLS policies applied to staging; `requireTenantContext()` + Prisma `$extends` auto-inject tenantId on all tenant-scoped models)
- [x] **S4** Database baseline + Prisma schema — apply v2 schema. `prisma migrate deploy` clean; seed script creates one demo tenant. (2026-04-27 — migration `20260427055126_initial_schema` applied to staging Postgres; seed.ts creates "Acme Brokers" demo tenant via upsert)
- [x] **S5** Background job queue (BullMQ + Redis) — sample `hello-world` job dispatched and processed; Redis health check at `/api/health/redis`. (2026-04-27 — BullMQ worker + ioredis in `apps/web/src/server/jobs/`; started via `instrumentation.ts`; Azure Cache for Redis Basic C0 deployed to staging; `/api/health/redis` pings live Redis)

## Phase 1B — Registries / Screen 0 (S6–S12)

- [x] **S6** Global Reference seeding — Country (249), Currency (9), Industry (SSIC 2020 subclasses). (2026-04-27 — `prisma/seeds/global-reference.ts`; SG has uenPattern `^[0-9]{8,10}[A-Z]$`, MY has SSM pattern; seed runs via `pnpm prisma db seed`)
- [x] **S7** Operator Library seeding — `OperatorLibrary` per v2 §3.2. 6 data type rows (string, integer, number, boolean, date, enum). (2026-04-27 — `prisma/seeds/operators.ts`)
- [x] **S8** Insurer Registry CRUD UI — Screen 0b. (2026-04-27 — `/admin/catalogue/insurers` list + inline add form + edit page; `insurers` tRPC router with list/byId/create/update/delete via `tenantProcedure`. Live UI verification gated on WorkOS provisioning, same as S2.)
- [ ] **S9** TPA Registry CRUD UI — Screen 0c. Catalogue admin can add IHP supporting Tokio Marine Life.
- [ ] **S10** Pool Registry CRUD UI — Screen 0d. Catalogue admin can add "Generali Pool — Captive" with Great Eastern as member.
- [ ] **S11** Employee Schema editor — Screen 0a with built-in/standard/custom tiers. Built-ins immutable; standards toggleable; customs added with name validation `^employee\.[a-z_]+$`.
- [ ] **S12** Product Catalogue editor — Screen 0e. Edit GHS productType: add `maternity_rider` field, save, publish v2.5; downstream form renders the new field.

## Phase 1C — Client onboarding setup (S13–S17)

- [ ] **S13** Client CRUD (Screen 1) — broker admin adds Balance Medical with country=SG, UEN validator passes.
- [ ] **S14** Policy + entities (Screen 2) — STM client has 3 PolicyEntities each with own policy number; `rateOverrides` JSONB accepts null and sample override.
- [ ] **S15** Product selection (Screen 3) — Insurer dropdown filtered by `productsSupported` matching the row's product type; CUBER saves with 10 products spanning Tokio Marine + Zurich + Allied World.
- [ ] **S16** Catalogue seed scripts — seed all 12 ProductTypes per v2 §3.5 with schemas, planSchemas, premiumStrategy refs, and Tokio Marine + Great Eastern parsing rules. `npm run seed:catalogue` populates 12 rows; GHS planSchema includes `stacksOn` and `selectionMode`.
- [ ] **S17** Benefit year + draft state — creating a Policy auto-creates the first BenefitYear in DRAFT; only admin can transition to PUBLISHED.

## Phase 1D — Predicate builder / Screen 4 (S18–S20)

- [ ] **S18** Predicate builder reading EmployeeSchema dynamically — opening Screen 4 for a tenant with `hay_job_grade` (custom) shows it in the field dropdown; selecting populates operator dropdown with integer operators; value is a number bounded by schema min/max.
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
- [ ] **S35** TPA claims feed (IHP) — sample IHP claim feed CSV ingested; Enrollment lookups match claims to employees + plans; unmatched claims flagged.

---

## Three Clients acceptance test (v2 §9)

When all 35 stories are done, this end-to-end test must pass:

- [ ] Balance Medical — 4 products (GTL, GHS, GPA, WICI), 0 blockers, 0 warnings, publishes; portal shows 3 enrolled employees on GHS Plan 1 EO.
- [ ] CUBER AI — 10 products, 1 GBT cover-basis warning (acknowledgeable), publishes; portal shows 5 enrolled employees on the correct plans.
- [ ] STMicroelectronics — 7 products, 6 benefit groups (4 compound), Plan C/D rider stacks, 3 PolicyEntities, 0 blockers; portal shows a Foreign Worker on GHS Plan 5 + GTL Plan B.

## Definition of done (v2 §13)

- [ ] All 35 stories landed behind green CI.
- [ ] Three Clients scenarios all pass.
- [ ] SEC-001 through SEC-010 (v2 §7) implemented with integration tests.
- [ ] A new client (CUBER-complexity) can be onboarded end-to-end in <30 min through the UI alone.
- [ ] A catalogue admin can add a new ProductType in-session with no deploy.
- [ ] Cross-tenant isolation has a passing test.
