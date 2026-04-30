# Progress log

Running record of Claude Code sessions. Newest entries on top. Each entry: session date, session focus, what changed, what decisions were made (and why), and what's next. Future sessions append here.

---

## 2026-04-30 (later) — Admin UI/UX consistency pass

**Session focus.** Audit the full admin tree for navigation/flow inconsistencies after the import-first wizard landed, fix all issues found, and unify the create-page pattern across every section.

**What landed.**

- **`/admin/clients` is now listing-only.** Stripped the inline create form; added a single `+ Add new client` action button in the screen-shell head pointing to `/admin/clients/new` (the two-tile mode picker). Empty-state CTA also routes there.
- **Catalogue + policies migrated to the `/new` page pattern.** Inline-create forms removed from `insurers`, `tpas`, `pools`, and per-client `policies` listing pages. Each got a sibling `_components/<x>-create-form.tsx` and a server-shell `new/page.tsx`. Policy create routes to `/edit` on success so the broker can configure entities.
- **Edit forms wrapped in `<ScreenShell>`.** Five edit forms (`clients/[id]/edit`, `catalogue/{insurers,tpas,pools}/[id]/edit`, `catalogue/product-types`) replaced bare `<h1>` with the standard screen-shell head — consistent with every other screen.
- **Section rail clarity.** `ClientsListRail` now exposes both "All clients" (exact-match) and "New client" so the wizard route doesn't make "All clients" appear active.
- **Broken link fixed.** `import-review-screen.tsx:251` linked to `/benefit-years/new` (404). Repointed to the policy `/edit` page, where benefit-year creation actually lives via `BenefitYearsSection`.
- **Fake-content placeholders removed.** Stripped example values from form inputs across 10+ files (insurer/TPA/pool/policy/employee-schema/product-type/benefit-group/plan/AI-provider). Kept functional UX hints (`"From"`, `"To"`, `"0"`, `"Pick a field first"`, `"optional"` markers).
- **Simplification pass.** Memoized country lookup in clients-screen (`O(rows × countries) → O(rows)`); dropped redundant `<section>` wrapping single-card create forms; extracted `<EmptyListState>` primitive (5× duplication eliminated); extracted `REGISTRY_CODE_PATTERN` + `REGISTRY_CODE_HELP` constants in `@insurance-saas/shared-types` (5 hardcoded copies of the regex collapsed).

**Decisions and rationale.**

1. **Two import paths kept side-by-side, not merged.** Orphan upload (`extractionDrafts.applyToCatalogue` from `/admin/clients/new`) creates Client + Policy + BY in one transaction; bound upload (`placementSlips.applyToCatalogue` from `/admin/clients/[id]/imports`) applies a slip to an existing client's DRAFT benefit year. Different mutations, different lifecycles — correct by design.
2. **`<EmptyListState>` extracted, full `<ListingScreen>` not.** The empty-state markup was 5× verbatim. The full listing shell wraps a too-divergent table (each list has custom columns/pills) — extracting it would reinvent TanStack Table.
3. **Create+edit form unification deferred.** Reuse review flagged ~500 lines of near-duplication between `*-create-form.tsx` and `[id]/edit/_form.tsx`. Real ROI but high regression surface; postponed for a focused refactor pass.

**Verification before push.** `pnpm typecheck` clean, `pnpm lint` clean, `pnpm build` clean (all new `/new` routes registered).

---

## 2026-04-30 — Import-first Create Client wizard (Phase 2A foundation)

**Session focus.** Replace the manual `/admin/clients` create form with an import-first wizard at `/admin/clients/new` that drops a placement slip, runs the AI extraction pipeline end-to-end, and lands the broker on a 10-section editable form. Section UI for all 10 sections (no placeholders), backed by a single `ExtractionDraft` row.

**What landed.**

- **DB foundation — migration `20260430140000_wizard_foundation`.**
  - `PlacementSlipUpload`: `clientId` becomes nullable, direct `tenantId` column added (back-filled from existing rows), RLS policy switched from parent-FK to direct-tenant. Orphan uploads (no client yet) are now first-class.
  - `Policy.ageBasis` enum (`POLICY_START | HIRE_DATE | AS_AT_EVENT`) — drives how the predicate engine resolves `employee.age_next_birthday`.
  - `BenefitYear.carryForwardFromYearId` self-FK for renewal carry-forward.
  - 7 new tables with RLS + FORCE: `BenefitGroupPreset` (reusable predicates), `EndorsementCatalogue` / `ExclusionCatalogue` (tenant-scoped plan-remark codes), `PolicyException` (employee carve-outs / grandfathered exceptions), `FlexBundle` + `FlexBundlePlan` (Flex S/M/MC/MC2 picker shape), `ProductAttachment` (product summary file attachments), `IssueType` (system-managed taxonomy of every issue the wizard / parser / extractor can surface — no tenantId).
  - New RLS helper `app_tenant_of_flex_bundle()`. `TENANT_MODELS` in `db/tenant.ts` extended from 10 → 14 (added BenefitGroupPreset, EndorsementCatalogue, ExclusionCatalogue, PlacementSlipUpload).

- **Catalogue seed extensions.** `PRODUCT_BASE_PROPERTIES` gained `sum_assured_currency`, `premium_currency`, `notes`, and `age_limits.no_underwriting_max_age` (Inspro had this as a separate field from the SI cutoff). `SCHEDULE_REMARK_PROPERTIES` (`endorsements[]` + `exclusions[]` arrays of `{code, description}`) baked into every product's `planSchema.schedule` via `planSchemaFor()` — applies generically to all 12 product types, no per-product changes.

- **AI extraction pipeline (`server/extraction/`).**
  - `heuristic-to-envelope.ts` — pure function: `ParseResult → ExtractedProduct[]` matching `extracted-product.json`. Wraps every leaf in `{value, raw, confidence, sourceRef}`. Confidence = 1.0 for non-empty parsed cells, 0.6 for regex-derived, 0 for empty. Per-tier and per-block premium rates layered on via the catalogue's `rate_column_map`.
  - `predicate-suggester.ts` — plan-label text → JSONLogic predicate referencing `employee.*` field paths. Pattern table extracted to `predicate-patterns.ts` and shared with `parser.ts` (the `Bargainable` mapping had silently diverged between the two — `parser.ts` mapped to a non-existent `employee.bargainable: true` boolean while the suggester correctly mapped to `employee.employment_type == 'BARGAINABLE'`; reconciled to the suggester's version since `employment_type` is the seeded STANDARD enum field).
  - `reconciliation.ts` — computed-vs-declared totals report. Computed = sum of fixed-amount rates per product today; rate-per-thousand reconciliation activates once the Plans tab grows headcount × SI inputs. Slip-declared totals stay null until the parser learns to read the billing-numbers sheet.
  - `extractor.ts` — orchestrator wired into `placementSlips.uploadOrphan`. Runs heuristic → envelope → suggestions in one pass. Loads `productType` + `employeeSchema` via `Promise.all`. The LLM stage hook is wired but a no-op until `TenantAiProvider` BYOK lands; turning it on later doesn't change the contract — every section will keep reading the same envelope.

- **Backend wiring.**
  - `placementSlips.uploadOrphan` — new mutation accepting only filename + bytes, persists upload + ExtractionDraft (READY) for the wizard. JSON size guard caps `extractedProducts` at 4 MB.
  - `extraction-drafts.ts` — new tRPC router with `listOrphans` (resume mid-wizard), `byUploadId`, `updateExtractedProducts`, `discard`, `applyToCatalogue` (single Prisma transaction creating Client + Policy + PolicyEntities + BenefitYear, binding the upload, marking the draft APPLIED, writing AuditLog). PolicyEntities use `createMany` instead of a loop.
  - Refactor: extracted `assertExcelBuffer()` and `persistUploadBytes()` helpers in `placement-slips.ts` so the bound and orphan upload paths share magic-byte sniff and SharePoint scaffolding (~110 lines deduped). `COVER_BASIS_BY_STRATEGY` and `excelColumnIndex()` extracted to `server/catalogue/premium-strategy.ts`.

- **UI — `/admin/clients/new` and `/admin/clients/new/import/[uploadId]`.**
  - **Mode picker** at `/admin/clients/new`: two-tile entry (Import slip / Type details) plus a "Resume in-progress imports" list of orphan drafts.
  - **Wizard shell**: three-pane layout, left rail with 10 sections + status icons (✓ / ● / ○ / ⚠), URL hash for deep-linking, prev/next footer. Section dispatch is a `SECTION_COMPONENTS: Record<SectionId, ComponentType>` registry, not a ternary chain.
  - **All 10 sections shipped as functional UI** (no placeholders): Source summary, Client form, Policy entities (table editor with master radio), Benefit year (dates + age-basis chips), Insurers & pool (registry cross-reference + add-to-registry deep link), Products (per-product picker + 4 sub-tabs Details/Plans/Rates/Endorsements with confidence dots, source-cell breadcrumbs, stacking visualisation, per-tier and per-block rate matrices), Eligibility (suggested groups checklist + groups × products default-plan matrix with JSONLogic rendered in plain English), Schema additions (per missing field: Add CUSTOM / Map to existing / Drop term radios), Reconciliation (per-product totals with variance pill), Review & apply (summary + apply-readiness gate + single-tx commit).
  - **One-shot seeding guards** in wizard-shell and Client section via `useRef<string | null>` keyed on `draft.id` — tRPC refetches no longer re-seed and overwrite broker edits. `StackingTree` Maps memoized on `[plans]`.
  - **Shared utilities**: `apps/web/src/lib/file.ts` exports `readFileAsBase64` (lifted from three duplicates in imports-screen / claims-screen / create-mode-screen). `_types.ts` exports `extractedProductsFromDraft` and `suggestionsFromDraft` accessors so sections never reach into raw JSON.

**Decisions and rationale.**

1. **Orphan upload column shape.** Considered keeping clientId required and creating a stub `Client` row up-front, but that pollutes the Clients list with abandoned drafts and requires undoing the row on cancel. Nullable `clientId` + direct `tenantId` is simpler and lets the apply step bind in one transaction.
2. **Direct tenantId on PlacementSlipUpload.** The existing parent-FK helper RLS path returned null for orphan rows. Adding tenantId directly makes RLS a one-liner check that works for both shapes — same pattern as `User`, `ExtractionDraft`, `TenantAiProvider`.
3. **Heuristic-only extraction today; LLM hook is a no-op.** Real LLM calls (BYOK Azure AI Foundry per-tenant) need the prompt + few-shot examples calibrated against real slips, which is its own slice. The contract returned from `extractFromWorkbook` is already the full `ExtractedProduct[]` shape, so wiring an LLM later is a single-file change inside `extractor.ts`.
4. **No-placeholder sections.** Earlier slice left §5–9 as `<SectionPlaceholder>` cards. User pushback: "make sure all is cover and not just placeholder for Sections 5–9, please only extract and setup the mandatory data that make sense". All 5 now read real data, with clear "next slice" notes only on the bits that genuinely need follow-up (LLM enrichment, billing-numbers parser, endorsement catalogue seeding, per-product apply pipeline).
5. **`Bargainable` predicate reconciliation.** Two divergent mappings would have produced predicates referencing `employee.bargainable: true` (a field that doesn't exist) on the parser path and `employee.employment_type == 'BARGAINABLE'` on the suggester path. Reconciled to the suggester's version since `employment_type` is a seeded STANDARD field and `bargainable` would have required a tenant schema migration. Pattern table now lives in one module so this can't happen again.
6. **Apply transaction scope: foundational rows only.** This slice's Apply creates Client + Policy + PolicyEntities + BenefitYear and binds the upload. Per-product Plans / PremiumRates / BenefitGroups / ProductEligibility are still written via the existing `placementSlips.applyToCatalogue` from inside the wizard's Products / Eligibility sections (next slice). Splitting the transaction this way means the user lands on a real client even if a later step needs a re-run.

**What's next (Phase 2A continuation).**

- LLM stage in `extractor.ts` — actual call against `TenantAiProvider`, prompt-cached system preamble + per-(productType, insurer) few-shot examples sourced from `parsingRules.templates.examples[]`.
- Per-product apply pipeline merged into `extractionDrafts.applyToCatalogue` — Plans / PremiumRates / BenefitGroups / ProductEligibility / EmployeeSchema additions all in the same transaction as the foundational rows.
- Billing-numbers sheet parser → declared totals → reconciliation Variance column.
- Endorsement / Exclusion catalogue seed data per tenant + `comments` sheet → catalogue-code mapping.
- Effective-dated rate / plan changes mid-year (UI surface for `Plan.effectiveFrom/To`).
- Flex bundle composition UI (`FlexBundle` schema is in place).

**Verification before push.** `pnpm typecheck` clean, `pnpm lint` clean, `pnpm build` clean (wizard route at 11.7 kB, mode picker at 3.65 kB).

---

## 2026-04-28 — Phase 1 close-out (S23 → S35 + SharePoint + security pass)

**Session focus.** Close every remaining Phase 1 story in one stretch (S23 eligibility through S35 claims feed), swap Azure Blob for SharePoint storage, then run a security/cleanup audit and apply the fixes.

**What landed.** All entries are per-story in `docs/PROGRESS.md`; this log entry summarises the scope.

- **Phase 1E close (S23/S24/S25)** — Eligibility matrix (`productEligibility` router), Premium calc with five strategy modules under `apps/web/src/server/premium-strategies/` plus a `premiumRates` router, effective-dated plan filter via `asOf` parameter on `premiumRates.estimate`. CUBER GHS scenario test pinned the AC: 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1948 ±$1.
- **Phase 1F close (S26/S27/S28)** — Single `/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/review` screen wrapping summary + validation engine + publish. `review.publish` re-runs validation server-side, checks `Policy.versionId` for optimistic lock, transitions DRAFT→PUBLISHED in a single transaction, role-gated to TENANT_ADMIN/BROKER_ADMIN.
- **Phase 1G structural ship (S29-S32)** — `placementSlips` router + generic exceljs parser + `/admin/clients/[id]/imports` upload + review UI + per-issue resolve flow. Storage **switched from Azure Blob to SharePoint** mid-phase (see below). Per-template fidelity (Balance/CUBER/STM dollar-accurate output) needs the actual placement-slip files to calibrate cell coords — the seeded TM_LIFE/GE_LIFE rules in `parsingRules` carry placeholders. The plumbing is structurally complete; real slips arriving is a JSON edit, not a code change.
- **Phase 1H close (S33/S34/S35)** — `employees` router with @rjsf-rendered form auto-generated from per-tenant `EmployeeSchema`, automatic group-matching via JSONLogic on every write, batched CSV import (10k row cap, single `createMany`). `claimsFeed` router with IHP CSV handler; new migration `20260428000000_readd_insurer_claim_feed_protocol` re-adds the column per ADR 0004; insurer admin form gained the protocol field.
- **SharePoint storage** — replaced Azure Blob plan with the same pattern PAD uses (`apps/web/src/server/storage/sharepoint.ts`, ROPC delegated auth via `/me/drive/root:/`). Files land in the `BenefitsCare@inspro.com.sg` service account's OneDrive at `/lts-placement-slips/<tenant-slug>/<client-id>/<timestamp>__<filename>`. Five `AZURE_*` env vars wired as Container App secrets on staging via `az containerapp secret set` + `az containerapp update --set-env-vars`; revision `0000036` is Running with the env in scope. ROPC auth verified end-to-end against the inspro tenant. When env vars are absent, the upload path falls back to inline markers for local dev. `placementSlips.reparse` and `placementSlips.delete` added for SharePoint-backed uploads.
- **Security + cleanup pass.** Three parallel audit agents (security-engineer + refactoring-expert) identified 11 findings across CRITICAL → LOW. Fixed everything CRITICAL/HIGH/MEDIUM in a single commit:
  - **CRITICAL**: cross-tenant `clientId` leak in `claims-feed.ingest`; missing role gate on `review.publish`; `plans.validateStacksOn` cycle walker now scoped to `productId` instead of unscoped `findUnique`.
  - **HIGH**: SharePoint Graph error bodies stripped from client-facing messages (5 sites in `sharepoint.ts` + `placement-slips.ts`); `employees.importCsv` capped at 10k rows + switched to batched `createMany` instead of N synchronous `create` calls.
  - **MEDIUM**: JSONLogic predicate now bounded to 16 KB / 16-deep / 256 nodes via Zod `superRefine`; XLSX magic-byte sniff (`PK\x03\x04`) before exceljs allocates parser state; Ajv compile wrapped in a shared `safeCompile` helper (new `apps/web/src/server/catalogue/ajv.ts`) that returns a structured error on schema-malformed-by-tenant-admin instead of crashing the request.
  - **Cleanup**: shared Ajv singleton consolidated 4 separate instances; new `predicate.test.ts` covers the JSONLogic round-trip (suite total now 25 tests).
- **Documented as Phase 2 hardening, not fixed today**:
  - Per-action role gates beyond `setState`/`publish` — Phase 1 is admin-only so the surface area is intentional
  - RLS policies on Policy/BenefitYear/Plan/Employee/etc. — currently app-layer isolation only via `client: { tenantId }` joins
  - Bicep param drift on infra deploys — the SharePoint env vars live as Container App secrets, not in the Bicep template; a future infra deploy would strip them. Mitigation: re-run the `az containerapp secret set` two-liner. Adding the params to Bicep + GitHub repo secrets is on the Phase 2 list.

**Decisions and rationale.**

1. **SharePoint > Azure Blob.** User mandate. PAD is the pattern source; LTS lifts `sharepoint.ts` near-verbatim. Same service account (`BenefitsCare@inspro.com.sg`) used across both projects. ROPC trades MFA-on-the-service-account for simpler delegated auth than client-credentials with site-level admin consent — same trade-off PAD made.
2. **Phase 1G ships structural.** Without reference placement slips in the repo, dollar-accurate Balance/CUBER/STM output isn't achievable. The plumbing (upload → SharePoint → exceljs → parsing-rules dispatch → review UI → apply hook) is end-to-end complete, so when the real files land it's a `parsingRules` JSON update, not a code change.
3. **Predicate caps via Zod superRefine, not a separate validator.** Keeps the validation co-located with the schema. `measurePredicate` is a single 15-line tree walker.
4. **`safeCompile` extracted to `server/catalogue/ajv.ts`** instead of inline try/catches in every router. Single audit point for all catalogue-backed validation. Ajv's internal compile cache benefits from a singleton instance.
5. **Re-sequenced where the v2 plan order didn't match FK dependencies.** Phase 1C: S13 → S14 → S17 → S16 → S15 (Product needs benefitYearId, so BenefitYear had to land first). Documented in S17's PROGRESS row.

**Verification.**

- 25 unit tests passing across 6 files.
- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean before every push.
- Staging Container App revision `0000036` Running with the SharePoint env vars in scope.
- ROPC token flow verified live against the inspro tenant.

**Phase 1 status — closed.**

| Phase | Stories | State |
|---|---|---|
| 1A Foundation | S1-S5 | ✅ |
| 1B Registries | S6-S12 | ✅ |
| 1C Client onboarding | S13-S17 | ✅ |
| 1D Predicate builder | S18-S20 | ✅ |
| 1E Per-product config | S21-S25 | ✅ |
| 1F Review + publish | S26-S28 | ✅ |
| 1G Excel ingestion | S29-S32 | ⚠️ structural (parsing rules need real slips) |
| 1H Employees + claims | S33-S35 | ✅ |

**Open items / next.** See the bottom of this file or `docs/PROGRESS.md` for the Phase 2 backlog. Top items: real placement-slip parser calibration (Balance/CUBER/STM); WorkOS swap-back when SSO is asked for; RLS extension to non-tenant-scoped tables; per-action role gates beyond publish; TMLS / DIRECT_API claim handlers.

---

## 2026-04-28 — S22 Plans sub-tab (stacksOn + selectionMode)

**Session focus.** Build Screen 5b — the plans table with `stacksOn` rider support and `selectionMode`. STM GTL Plan C/D stacks on Plan B; this is the schema's first real use of the rider relation.

**What landed.**

- **`plans` tRPC router.** listByProduct / byId / create / update / delete via `tenantProcedure`. Tenant-scoped through Plan → Product → BenefitYear → Policy → Client. DRAFT-only mutation gate enforced on grandparent BenefitYear.state.
- **Ajv validation per plan.** Full plan row (code + name + coverBasis + stacksOn + selectionMode + schedule + effective dates as ISO date strings) validated against `ProductType.planSchema` on every create/update. Catches schema-level constraints like the planSchema's required fields and per-product `coverBasis` enum narrowing.
- **stacksOn validator.** `validateStacksOn(productId, stacksOn, selfPlanId?)` runs three checks: (1) reject self-loops where `stacksOn === selfPlanId`, (2) reject cross-product references (`target.productId !== productId`), (3) walk the rider chain forward and reject if any cursor matches `selfPlanId` (would create a cycle). Visited set caps the walk so a pre-existing DB-level loop doesn't infinite-loop us.
- **stacksOn delete protection.** Deleting a plan that's referenced as a base by other plans returns CONFLICT with a "detach the rider first" message. Plans with eligibility/premium-rate FKs surface as P2003.
- **Plans tab on product edit page.** Surfaces a table of existing plans — code, name, coverBasis, stacksOn (rendered as the base plan's code, looked up via `Map<id, code>` over the same list), selectionMode label, effective dates. "+ Add plan" deep-links to `/plans/new`, each row to `/plans/[planId]/edit`.
- **PlanForm component shared between new + edit pages.** Two-section layout: hand-rolled metadata (code with regex `^P[A-Z0-9]+$`, name, coverBasis dropdown from `extractCoverBasisEnum(planSchema)`, stacksOn dropdown of siblings excluding self when editing, selectionMode select with explanatory copy for broker_default vs employee_flex, effective dates) plus an `@rjsf/core` form for the `schedule` sub-object. Submit serialises dates to native `Date` objects so Zod's `.coerce.date()` round-trips them back to JS `Date` on the server.

**Decisions and rationale.**

1. **Hand-roll metadata, @rjsf for schedule only.** A full @rjsf form against planSchema would render the metadata fields too — but stacksOn needs a sibling-plan dropdown (custom widget territory), and coverBasis is a simple enum we already extract. Splitting the form: the @rjsf payoff (auto-rendered, dynamic, schema-driven) lives in `schedule`, which differs sharply per ProductType. Metadata stays in our own tabular CSS so the rest of the admin doesn't visually drift.
2. **`stacksOn` is `Plan.id`, not `Plan.code`.** The schema stores the FK by id and Prisma's self-relation `riderOf` keys off it. Storing by code would mean updating every rider when a base plan's code changes — not worth the convenience. The UI shows code in the dropdown for usability, but persists the id.
3. **Cycle detection walks the chain, not a graph algorithm.** Plans form a forest by intent (each plan stacks on at most one base). A linear walk + visited set is enough; full graph cycle detection would be overengineered.
4. **No optimistic locking on Plan.** Unlike Policy, Plans don't have concurrent-edit hazards in the broker workflow — one human edits one plan at a time. Add later if needed.
5. **Schedule update propagates through @rjsf's `onChange`, not on submit.** The whole point of @rjsf is real-time validation. Buffering the form data until submit loses that — the @rjsf component manages its own sub-state and we read it on every change. Submit just bundles the latest schedule with the metadata fields and ships the lot.
6. **Effective dates serialise as ISO date strings inside the validation payload.** Plan dates round-trip to/from `Date` objects in TypeScript, but Ajv evaluates JSON — feeding it a JS Date would compare `new Date()` against an ISO-string format clause in the schema. Convert at the validation boundary.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` all clean.
- 11/11 unit tests still pass.
- Routes added: `/admin/.../products/[productId]/plans/new` and `/admin/.../plans/[planId]/edit`.

**Open items / next.**

- **S23 Eligibility matrix.** Groups × plans grid; per cell, a default plan id (or "ineligible") for that (group, product) pair. Saving creates ProductEligibility rows.
- **S24 Premium calc.** Strategy code from `ProductType.premiumStrategy` selects which calc module renders the input form and computes the preview. CUBER GHS → 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948 ±$1.
- **S25 Effective-dated schedules.** Plans already accept `effectiveFrom`/`effectiveTo` (added in this story); S25 wires the eligibility engine + premium calc to honour the boundary.
- **S22 deferral.** Plan AC mentions "eligibility engine applies both Plan B and Plan C cover to a matching employee in dry-run" — the dry-run runtime is a S24 premium-calc concern. Data shape + validation shipped here; runtime evaluation lands with the calc engine.

---

## 2026-04-28 — S21 Product details sub-tab (Phase 1E opens)

**Session focus.** Open Phase 1E with the per-product Details tab. Auto-generate the form from `ProductType.schema` via `@rjsf/core`, validate server-side via Ajv before persisting `Product.data`.

**What landed.**

- **`@rjsf/core` + Ajv stack installed.** Five new deps: `@rjsf/core`, `@rjsf/utils`, `@rjsf/validator-ajv8`, `ajv`, `ajv-formats`. CLAUDE.md mandates this combination ("Admin forms are generated from catalogue JSON Schemas via `@rjsf/core`. Do not hand-write forms for product-specific data."). React 19 compatibility verified — @rjsf/core peerDeps say `react: >=18`.
- **Server-side Ajv validation** added to the products router. New module-level `Ajv` instance with `strict: false` and `addFormats(ajv)` so date / email / similar formats validate. Added a `products.updateData` mutation that compiles `ProductType.schema` per request (Ajv caches by reference, so unchanged schemas hit the compile cache) and rejects the mutation with a structured error message listing every Ajv path + reason on validation failure.
- **`products.byId` query** added so the edit page can load Product + ProductType.schema + BenefitYear.state + insurer/tpa/pool names in one round-trip.
- **`/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/products/[productId]/edit`** — sub-tab host page. Four buttons: Details (live), Plans (S22 placeholder), Eligibility (S23 placeholder), Premium (S24 placeholder). Disabled non-Details tabs surface "Coming in a later story".
- **`ProductDetailsTab` component** renders an `@rjsf/core` `<Form>` with `validator={validator}` from `@rjsf/validator-ajv8`. Form is `disabled` when the parent BenefitYear is not DRAFT; submit posts to `products.updateData`. The default RJSF submit button is hidden via `uiSchema={{ 'ui:submitButtonOptions': { norender: true } }}` and replaced with our own button so styling stays consistent with the rest of the admin.
- **"Configure" deep-link** added to each row of the products list (always visible — read-only mode also benefits from viewing configuration). "Remove" stays gated on `editable`.

**Decisions and rationale.**

1. **Use @rjsf/core despite the bundle cost.** The product edit page bundle ballooned from ~3 kB to 101 kB. Hand-rolling a JSON-Schema → form renderer would have been ~200 LOC and shipped a 4 kB page, but CLAUDE.md is unambiguous: "Do not hand-write forms for product-specific data." The directive exists because product schemas are catalogue-authored at runtime via S12 — schemas can grow `oneOf`, `dependencies`, `if/then/else`, format-typed strings, and re-implementing all of that is a multi-week sink. @rjsf already covers the spec. Lazy-loading via `next/dynamic` is the right escape hatch when the page becomes hot.
2. **Re-validate server-side.** Browser-side @rjsf validation is for UX. The server compiles the same schema with Ajv and rejects writes that don't conform. Two reasons: API callers bypass the browser, and a published-then-edited schema in the catalogue could let a stale browser pass invalid `Product.data`. Server is authoritative.
3. **`Ajv strict: false`.** Our seeded schemas include `description` keywords on properties that aren't in the JSON Schema spec strictly. With `strict: true`, Ajv warns and refuses to compile some shapes. `strict: false` lets the catalogue grow keywords (display hints, format aliases) without breaking validation.
4. **Compile per request, not at boot.** `ProductType.schema` can be edited at runtime via S12 — a boot-time compile cache would serve stale schemas after a catalogue edit. `ajv.compile(schema)` is fast enough (sub-millisecond for our shapes) that doing it per validation is acceptable. Ajv's internal cache keys by reference equality, so the same Prisma-fetched object skips recompilation on hot calls.
5. **Sub-tab host renders inline, not via nested routes.** Could have had `/.../products/[productId]/details/page.tsx` and three sibling pages, but four routes for one logical "edit a product" flow felt overbuilt for what's really one entity. Inline `<ProductEditScreen>` component switches `useState<Tab>`. Plans/Eligibility/Premium will plug into the same component in S22-S24.
6. **`Ajv` import shape.** Default export from the v8 package is the constructor; named `ErrorObject` import for the typing. Doesn't need a CJS interop tweak under our `esModuleInterop: true`.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- 11/11 unit tests still pass.
- New routes in build manifest: `/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/products/[productId]/edit` (101 kB / 230 kB total). The 100 kB delta is `@rjsf/core` + ajv-formats + the schema compiler.

**Open items / next.**

- **S22 Plans sub-tab.** Repeating-row table validated against `ProductType.planSchema`. Includes `stacksOn` (dropdown of base plans) and `selectionMode` (broker_default / employee_flex). STM Plan C/D stacks-on validation lives here.
- **S23 Eligibility matrix.** N benefit groups × M plans matrix; per cell, a default plan id (or "ineligible") for that (group, product) pair.
- **S24 Premium calc.** Strategy auto-selected from `ProductType.premiumStrategy`; inputs vary per strategy. CUBER GHS computes 1×$1260 + 4×$172 = $1,948 ±$1 acceptance.
- **S25 Effective-dated schedules.** Plans with `effectiveFrom` mid-year; eligibility engine + premium calc respect the boundary. Lands as a Plan.effectiveFrom/effectiveTo addition in S22 and a runtime check in S24.

---

## 2026-04-28 — S20 Overlap detection (closes Phase 1D)

**Session focus.** Surface a warning when saving a benefit group whose predicate already intersects with another group on the same policy. Acknowledgeable, not blocking.

**What landed.**

- **`benefitGroups.checkOverlap` query.** Loads every other group on the policy plus every employee on the client, then runs `jsonLogic.apply(candidate, e.data) && jsonLogic.apply(other.predicate, e.data)` per pair. Returns `{ overlaps: [{ id, name, intersection }], otherGroupCount, employeeCount, noEmployeesYet }`. Wraps each row in try/catch so a malformed prior predicate or a rogue employee record can't kill the whole check. `excludeId` parameter prevents the editing group from matching itself.
- **Submit-time gate in the UI.** Refactored the predicate builder's submit handler:
  1. Build the JSONLogic from form rows (extracted `buildPredicate` helper for reuse).
  2. Call `utils.benefitGroups.checkOverlap.fetch()` with the policy + candidate predicate.
  3. If `overlaps.length > 0`, set `overlapWarning` state and render a yellow warning card listing each conflict + shared-employee count.
  4. The primary submit button stays disabled with "Checking…" text during the fetch; on warning, a `Save anyway` button appears next to it.
  5. `acknowledgeAndSave` rebuilds the predicate (in case the user tweaked it after seeing the warning) and persists without re-checking.
- **`utils.benefitGroups.checkOverlap.fetch`** chosen over `useQuery` because the check is event-driven (fires only on submit), not subscription-style. tRPC's utils API exposes the imperative one-shot fetcher we need.
- **`noEmployeesYet` warning copy.** When `employeeCount === 0`, the overlap check can't actually find intersections — but it'd be misleading to show "no overlaps" because the predicates might really overlap once employees exist. Surfacing both states explicitly: empty `overlaps` array AND a `noEmployeesYet: true` flag the UI uses to warn the user the check is structural-only. The form still proceeds to save because there's nothing to warn about *yet*.

**Decisions and rationale.**

1. **Advisory, not enforced.** The S20 AC says "user can acknowledge and save" — i.e., overlaps are a warning, not a block. Server save mutation doesn't re-check. If the client skips the check (custom API caller), saves go through. This matches how the spec frames overlap as "a thing the broker should know about", not a hard correctness rule. Some predicates *should* overlap intentionally (master-cohort + sub-cohort).
2. **Pairwise check, not n-ary.** Could check transitive overlap or cross-group implications, but the AC only asks "does this predicate share any employee with any other predicate". O(N×M) where N = other groups, M = employees. With Phase 1's expected scale (≤10 groups × ≤300 employees per client = 3,000 evals) this stays well under 100ms even with json-logic-js's interpretive cost.
3. **Run check via `utils.fetch`, not `useQuery`.** `useQuery` would re-run on every form keystroke (or require manual `enabled` gating that mirrors what we already do for the live preview). `utils.fetch` fires once per submit click — predictable and matches the user's mental model: "check happens when I press Save".
4. **`excludeId` in the input, not always passed.** Make it optional so create flows don't have to pass `undefined`. tRPC handles `excludeId?: string` cleanly.
5. **Re-build the predicate inside `acknowledgeAndSave`.** User might have changed the form between seeing the warning and clicking "Save anyway" — the live preview fields aren't disabled. Re-building catches that, and the cost is one zero-ms `useMemo` re-run.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- 11/11 unit tests still pass.
- The warning copy and "Save anyway" wiring renders locally; full overlap behaviour will exercise once Employees exist (S33).

**Phase 1D status — closed.**

| Story | Plan AC satisfied? | Note |
|---|---|---|
| S18 | ✅ | Field/operator/value dropdowns dynamic from EmployeeSchema + OperatorLibrary |
| S19 | ✅ | 500ms-debounced preview wired; "no employees yet" path renders correctly |
| S20 | ✅ | Pairwise overlap check + acknowledgeable warning + Save Anyway |

**Open items / next.**

- **Phase 1E — Per-product config / Screen 5 (S21–S25).** Five sub-tab stories: 5a Details (form rendered from `ProductType.schema`), 5b Plans (with stacksOn + selectionMode), 5c Eligibility matrix (groups × plans), 5d Premium calc (strategy library), 5e Effective-dated schedules. S21 first — auto-generated form from JSON Schema, probably via `@rjsf/core` per the v2 plan tooling list.

---

## 2026-04-28 — S19 Live employee match preview

**Session focus.** Wire the live preview onto the predicate builder. Show "Matches N of M employees" inline as the user types, debounced under 500ms.

**What landed.**

- **`benefitGroups.evaluate` query.** Server-side: takes `{ policyId, predicate }`, asserts the policy belongs to the tenant, loads `Employee.data` for every employee on that policy's client, and runs `jsonLogic.apply(predicate, employee.data)` per row to count matches. Returns `{ total, matched }`. Wraps each evaluation in try/catch so a row with surprising data doesn't kill the count for the rest of the cohort. Reuses the same `predicateSchema` Zod validator as create/update — same trust model: structurally valid JSONLogic, opaque to schema semantics.
- **Client-side preview pipeline.** Three layers in the predicate builder screen:
  1. `previewPredicate` (`useMemo`) re-derives the JSONLogic shape from the current form. Returns `null` if the form isn't yet a complete, valid predicate (missing field, missing operator, build error). Re-runs whenever the form, fields, or operator library change.
  2. `debouncedPredicate` (`useState` + `setTimeout` cleared on next render) lags the live shape by 500ms. Only the most-recent stable shape ever fires the query.
  3. `trpc.benefitGroups.evaluate.useQuery` runs against the debounced shape, gated by `enabled: debouncedPredicate !== null`.
- **`<MatchPreview />` indicator.** Four discrete states: `not ready` (form incomplete), `pending` (form changed, debounce hasn't fired yet), `loading` (query in flight), and `resolved` ("Matches N of M"). Special-cased "no employees yet" copy when total is 0 — without S33 there are no employees, so this is the path real users see today.

**Decisions and rationale.**

1. **Server-side evaluation, not client-side.** Could have shipped a `jsonLogic.apply` call on the client and avoided the round-trip, but it would mean either (a) sending all employees to the browser (PII leak — `Employee.data` is exactly the kind of data PDPA wants minimised), or (b) sending an opaque "match this against my data" RPC (same as what we built, just a worse name). Server-side keeps PII inside the trust boundary.
2. **Full scan, not incremental.** Phase 1's per-client headcount tops out around a few hundred for the Three Clients scenario. Indexing `Employee.data` JSONB for predicate-aware lookup is a real engineering problem (json_path ops, GIN indexes per common predicate shape) and Phase 1 doesn't need it. Note in the router comment: revisit when a tenant exceeds 50k employees.
3. **Debounce at the predicate level, not per keystroke.** The form has many inputs; a per-input debounce would miss cross-field changes (e.g. switching field type cascade-resets operator + value). Debouncing on `previewPredicate` (which already collapses every form change into a single derived value) is the right granularity.
4. **`enabled: debouncedPredicate !== null`.** tRPC's `useQuery` requires a stable input signature, so we pass an empty object placeholder when the predicate is null. The `enabled` flag prevents the placeholder from firing — no stray request goes out for invalid forms.
5. **Wrap each row in try/catch on the server.** A surprising employee record (e.g. one written before a custom field's type changed) shouldn't poison the whole count. We swallow per-row errors silently; if every row throws, `matched` is just 0 and the user sees "No matches" — which is the right behaviour while debugging.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- 11/11 unit tests still pass.
- Preview indicator renders in all four states locally (verified by mentally walking through the form transitions; no employees in dev so the "resolved" path renders the "no employees yet" copy).

**Open items / next.**

- **S20 Overlap detection.** On save, run the candidate predicate alongside every other predicate in the same policy against the full employee cohort, count rows that match both. If non-zero and the user hasn't acknowledged, surface a warning — second click commits.
- **No employees yet.** S19's preview will keep saying "No employees on this client yet — add employees to see live counts" until S33 lands.

---

## 2026-04-28 — S18 Predicate builder (Phase 1D opens)

**Session focus.** Build Screen 4 — the JSONLogic predicate builder for benefit groups. AC: tenant with custom `hay_job_grade` field shows it in dropdown; integer operators populate; value is number bounded by min/max.

**What landed.**

- **`benefitGroups` tRPC router** under `apps/web/src/server/trpc/routers/benefit-groups.ts`. listByPolicy / byId / create / update / delete via `tenantProcedure`, gated by joining through `policy: { client: { tenantId } }`. **Structural-only JSONLogic validation:** the server runs `jsonLogic.apply(predicate, {})` to compile-check the shape, but doesn't validate against the EmployeeSchema. Stored predicates stay opaque to the server, so future schema changes (renaming a field, removing a custom field) don't invalidate existing groups — semantic checks happen at evaluation time.
- **`json-logic-js` added** to `apps/web/package.json`. Used server-side for shape validation; will be used again at S19 for live employee-match preview and at S23+ for runtime eligibility evaluation. The TypeScript package only exposes `RulesLogic` as the recursive-shape type.
- **`referenceData.operators`** query exposes the `OperatorLibrary` table (system-level seed from S7) so the predicate builder can populate operators per data type.
- **`apps/web/src/lib/predicate.ts`** — bidirectional UI ↔ JSONLogic adapter. `uiPredicateToJsonLogic({ connector, rows })` builds the canonical shape; `jsonLogicToUiPredicate` recognises the shapes the builder produces (flat conditions, single-level and/or, between as `and(>=,<=)`, notIn as `!.in`, contains as `in[value, var]`) and returns null for anything deeper. Edit flow falls back to a fresh empty form + warning banner when a stored predicate doesn't round-trip.
- **`/admin/clients/[id]/policies/[policyId]/benefit-groups`** — Screen 4 page. Repeating predicate rows where each row picks: a field (from `EmployeeSchema.fields` filtered by `selectableForPredicates && (tier !== STANDARD || enabled)`), an operator (filtered by the field's data type), and a value control whose JSX shape varies by data type:
  - `integer` / `number` → numeric input with `min`/`max` from the schema (S18's headline AC)
  - `date` → date picker
  - `enum` (single arity) → `<select>` of `enumValues`
  - `enum` (multi arity for `in`/`notIn`) → multi-select chip group
  - `boolean` → true/false select
  - `string` → free text
  - `between` (range arity) → two inputs of the field's type with min/max preserved
- **Compound predicates baked in.** AND/OR connector dropdown appears when the user adds a second row. Single-row groups skip the connector. `between` translates to `{ and: [{ ">=": [...] }, { "<=": [...] }] }` so the JSONLogic stays canonical regardless of how the UI surfaces it.
- **Edit existing groups round-trips.** Clicking Edit decodes the stored JSONLogic and re-populates the form. If decoding fails (deeper nesting, hand-edited shapes the builder can't represent), the form resets and the user is warned that saving will overwrite.
- **Manage benefit groups CTA** added to the policy edit page below the BenefitYears section.

**Decisions and rationale.**

1. **Server validates shape, not semantics.** Two reasons. First, the EmployeeSchema is mutable per-tenant — strict server validation would reject a saved predicate the moment the broker disables a field, even if no employee actually uses it. Second, the parser story (S31) will produce predicates from Excel that include schema fields the broker may not have added yet; we want the parser to pre-populate groups that get fixed up afterward, not fail mid-import.
2. **Compound predicates from S18, not deferred.** S20's overlap detection and the parser's compound predicates (4 of 6 STM groups are compound) need this regardless. Single-row case is the same code path with `rows.length === 1`.
3. **Value coercion at submit time, not as-you-type.** Inputs hold strings; `coerce()` casts at build-row time. Lets the user type "1" without it being instantly tokenised, which makes the experience feel less twitchy on numeric and date fields.
4. **`useEffect` for "reset operator on field change" replaced with event handler.** Biome's `useExhaustiveDependencies` rule flagged the effect because `field`, `ops`, `row.operator`, and `onChange` were all referenced but only `field?.type` was in deps. Doing the reset in `onFieldChange` is cleaner anyway — it's an event-driven change, not a reactive consequence.
5. **`json-logic-js` for shape check, not Ajv.** Ajv is for JSON Schema validation; JSONLogic isn't a JSON Schema target. `jsonLogic.apply(predicate, {})` is the lightest possible round-trip — if it doesn't throw, the structure compiles. Cheap, correct, and reuses the same library we'll need for runtime evaluation.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- Existing 11/11 tests still pass.
- New routes in build manifest: `/admin/clients/[id]/policies/[policyId]/benefit-groups` (~4.7 kB).

**Open items / next.**

- **S19 Live employee match preview.** Show "matches N employees" inline as the predicate is built, debounced under 500ms. Needs a server-side evaluator that compiles the WIP predicate and counts matching `Employee.data` rows. Without S33 (Employee CRUD), there are no employees yet — the count will be 0; the wiring still needs to exist.
- **S20 Overlap detection.** On save, if another group's predicate has any employee overlap with the saved one, surface a warning the user can acknowledge. Cheapest implementation: evaluate both predicates against every Employee in the policy's client, count the intersection. Probabilistic optimisation (e.g. Bloom filter) only if real-world headcount makes the naive scan too slow.

---

## 2026-04-28 — S15 Product selection (closes Phase 1C)

**Session focus.** Build the Product picker UI under a BenefitYear. Headline AC: Insurer dropdown filtered by `productsSupported` matching the chosen ProductType. Closes Phase 1C.

**What landed.**

- **`products` tRPC router** under `apps/web/src/server/trpc/routers/products.ts`. listByBenefitYear / create / update / delete via `tenantProcedure`. Tenant gate joins through `benefitYear: { policy: { client: { tenantId } } }` — same pattern as benefitYears. listByBenefitYear hand-fetches Insurer + TPA names because they aren't relations on the Product model in the Prisma schema (just String FKs); the cost is two extra batched queries per response, fine at this scale.
- **`assertInsurerSupportsProductType`** loads both rows in parallel and rejects the mutation if `insurer.productsSupported` doesn't include the chosen ProductType's code. Also gates on `insurer.active === true`. The error message is UI-friendly and names both the insurer and the product type code so the broker knows what to fix in the registry.
- **DRAFT-only mutation gate.** `assertEditableBenefitYear` throws BAD_REQUEST when the year is PUBLISHED or ARCHIVED. Same gate on update + delete via `loadProduct → benefitYear.state` check. `versionId` increments on every update for downstream optimistic locking (S22+ plan editor will rely on it).
- **`/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/products`** — list + add form for one BenefitYear. Cascading dropdown logic:
  - Picking a ProductType drives `eligibleInsurers` via `useMemo` filtering on `productsSupported.includes(code) && active`.
  - If the user changes ProductType after picking an insurer, `onProductTypeChange` clears the insurer iff it no longer supports the new type.
  - Help text reads "Showing N insurers supporting GHS." so the filter is visible.
  - Pool + TPA dropdowns are simple optional refinements; TPA filtered to `active` rows.
- **DRAFT-only UI mode.** PUBLISHED/ARCHIVED years render the table read-only with a banner explaining why; no Add form, no Remove buttons. The server enforces this regardless.
- **Products deep-link** added to each BenefitYear row in `BenefitYearsSection`. `BenefitYearsSection` signature took a `clientId` prop to build the URL.

**Decisions and rationale.**

1. **Filter the insurer list on the client AND on the server.** The client filter is for UX (the user shouldn't see ineligible insurers in the dropdown). The server filter is for correctness (a curl request bypassing the UI must still be rejected). Two filters, one source of truth (`Insurer.productsSupported` array).
2. **`Product.data = {}` for now.** The Prisma column is required JSON but Phase 1's S15 AC only says "save 10 products spanning Tokio Marine + Zurich + Allied World" — i.e., the picker, not the configuration. S21 (Screen 5a, per-product details) is where the form field renderer reads `ProductType.schema` and lets the broker fill in `Product.data`. Empty object today, populated then.
3. **No unique constraint on (benefitYearId, productTypeId).** Removed the speculative P2002 branch from the create mutation. Reasoning: real placement slips do sometimes carry two products of the same type (e.g., a primary GHS plan plus a top-up GHS rider) under different insurers. If a real-world scenario ever requires uniqueness, add the constraint via migration then.
4. **Update mutation versions but doesn't change `data`.** `data` only changes via S21's full per-product editor; S15's update is for swapping insurer/pool/tpa. Splitting these keeps the audit trail clean — a "swapped insurer" event doesn't smell like a "rewrote the whole product config".
5. **Read-only mode renders the products table without action columns rather than disabled buttons.** Cleaner than a dimmed delete button — the user can immediately see what's locked.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` all clean.
- 11/11 unit tests still pass.
- New routes in build manifest: `/admin/clients/[id]/policies/[policyId]/benefit-years/[benefitYearId]/products` (~3.0 kB).

**Phase 1C status — closed.**

| Story | Plan AC satisfied? | Note |
|---|---|---|
| S13 | ✅ | Client CRUD with country-pattern UEN validation |
| S14 | ✅ | Policy + entities + rateOverrides JSON, optimistic lock |
| S17 | ✅ | Auto-create DRAFT BenefitYear; role-gated PUBLISH; immutable when published |
| S16 | ✅ | 12 default ProductTypes seeded; GHS planSchema has stacksOn + selectionMode |
| S15 | ✅ | Insurer dropdown filtered by productsSupported; server-validated |

**Open items / next.**

- **Phase 1D — Predicate builder / Screen 4 (S18-S20).** Build the benefit-group predicate builder reading from EmployeeSchema dynamically, with live employee-match preview and overlap detection on save. First story: S18 — predicate builder UI with field/operator/value dropdowns sourced from EmployeeSchema + OperatorLibrary.
- **No Employee data exists yet.** S19's "live match preview" needs employees in the DB to count against; we'll surface a "0 matches (seed employees first)" message until S33 lands. Acceptable for Phase 1D since the AC focuses on the dropdown wiring.

---

## 2026-04-28 — S16 Catalogue seed (12 ProductTypes)

**Session focus.** Seed the 12 default ProductTypes per v2 §3.5 so the Product Catalogue table has rows for S15 (Product selection) to render against.

**What landed.**

- **`prisma/seeds/product-catalogue.ts`** — 12 ProductTypeSeed entries: GTL, GCI, GDI, GPA, GHS, GMM, FWM, GP, SP, Dental, GBT, WICI. Each carries:
  - `schema` — shared `PRODUCT_BASE_PROPERTIES` (insurer, policy_number, eligibility_text, age_limits, member_cover, benefit_period, free_cover_limit, evidence_of_health_threshold) plus per-product extras (e.g. GHS gets `tpa`, `panel_clinics`, `letter_of_guarantee`; WICI gets `mom_class_codes`).
  - `planSchema` — shared `PLAN_BASE_PROPERTIES` (code, name, coverBasis, **stacksOn**, **selectionMode**, effectiveFrom, effectiveTo) plus a `schedule` block specific to the cover basis. Six schedule shapes: PER_TIER_HOSPITAL (GHS, GMM, FWM), PER_TIER_OUTPATIENT (GP, SP), PER_TIER_DENTAL (Dental), SALARY_MULTIPLE (GTL, GDI), FIXED_SUM (GCI, GPA), PER_REGION_TRAVEL (GBT), WICI (earnings bands).
  - `premiumStrategy` — one of the 5 codes from `PREMIUM_STRATEGIES`. Mapping mirrors v2 §4 Table.
  - `parsingRules` — Tokio Marine (TM_LIFE) and Great Eastern (GE_LIFE) Excel templates at seed time. Other insurers (Zurich, Allied World, Allianz, Chubb) get `null` until their templates are added at S30/S31. Both templates carry `product_field_map` (cell/range selectors), `plans_block`, `rates_block` for the parser to consume.
  - `displayTemplate` — a minimal `{ card: { title, summaryFields } }` placeholder; the employee portal at S33+ extends it.
- **`prisma/seed-catalogue.ts`** — standalone CLI runner. Iterates every tenant and calls `seedProductCatalogueForTenant`. Skips when no tenants exist (instructs the caller to run `pnpm db:seed` first). Fired via the new `pnpm seed:catalogue` script.
- **Folded into `prisma/seed.ts`.** The full bootstrap seed (`pnpm db:seed`, also wired through the `prisma.seed` config so `pnpm prisma db seed` triggers it) now calls `seedProductCatalogueForTenant(prisma, tenant.id)` after the EmployeeSchema seed. CI/CD's deploy step runs `pnpm prisma db seed` after `prisma migrate deploy`, so the next staging deploy will populate the 12 rows automatically.
- **Defensive drift check.** `PRODUCT_TYPE_SEEDS` is validated against `PRODUCT_TYPE_CODES` from `@insurance-saas/shared-types` at module load — adding a code to one list without the other throws at startup.

**Decisions and rationale.**

1. **Reusable schema fragments rather than 12 hand-rolled JSON Schemas.** The base properties recur on every product type; copy-pasting them invites drift (one product loses an `age_limits` validation by accident, no one notices). Composing via spread keeps the per-product file under 350 lines and makes "what's actually different about WICI" obvious — its `productSchema` extras and its WICI-specific `schedule.earningsBands`.
2. **`coverBasisOverride` per product.** The shared `PLAN_BASE_PROPERTIES.coverBasis` enum lists every option, but each product type narrows it via override (GHS only allows `per_cover_tier`; GBT only allows `per_region`). Lets us reuse the shared object yet still validate per-product on write.
3. **Parsing rules opt-in per product.** TM and GE templates are seeded only for the products those insurers actually offer (TM does GTL/GCI/GHS/GMM/GP/SP/Dental; GE does GTL/GHS/GMM/SP). GDI, GPA, FWM, GBT, WICI start with `parsingRules = null` because no template exists yet. Phase 1G's parser will gate on `parsingRules` being non-null before attempting to ingest.
4. **Standalone `seed:catalogue` runner alongside `db:seed`.** v2 plan AC says "`pnpm seed:catalogue` populates 12 rows" — implying a focused command that doesn't also create the demo tenant. Two scripts: `db:seed` is the full bootstrap (creates tenant + admin + global ref + catalogue), `seed:catalogue` is the surgical refresh (ProductType only, against every existing tenant). Both are idempotent.
5. **Schemas don't have `additionalProperties: false`.** Could lock down strictness, but Phase 1B's S12 lets admins extend product schemas at runtime. A globally-strict schema would reject any field added through the editor. Trust the editor's schema authoring; validation kicks in via Ajv at write-time per ADR.
6. **CI/CD picks up automatically.** No workflow change needed because `prisma db seed` is already in the deploy step. Next deploy hydrates the demo tenant with all 12 rows.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- One-off smoke check confirmed all 12 codes present + GHS planSchema has both `stacksOn` and `selectionMode`. (Smoke script removed after verification — no need to keep it in the repo.)
- Build manifest unchanged (server-only seed; no client bundle impact).

**Open items / next.**

- **S15 Product selection (Screen 3).** Now unblocked. Picker UI under a BenefitYear: repeating row of (ProductType, Insurer, Pool, TPA, per-entity policyNumber). Insurer dropdown filtered by `productsSupported` matching the row's product type code. CUBER acceptance: 10 products spanning Tokio Marine + Zurich + Allied World.

---

## 2026-04-28 — S17 BenefitYear + draft state (out-of-order)

**Session focus.** Land BenefitYear lifecycle ahead of S15 (Product selection), because Product carries `benefitYearId` as a required FK — without S17, S15's "save 10 products" AC isn't physically possible. Re-sequenced the phase as S17 → S16 → S15 instead of the v2 plan order S15 → S16 → S17.

**What landed.**

- **`benefitYears` tRPC router** under `apps/web/src/server/trpc/routers/benefit-years.ts`. Five procedures via `tenantProcedure`: listByPolicy / byId / create / updateDates / setState. Like the policies router, BenefitYear isn't directly tenant-scoped, so every read goes through `policy: { client: { tenantId } }` and writes load through a `loadBenefitYear` helper that does the same join.
- **State machine.** `rejectTransition(from, to)` rejects every move except DRAFT→PUBLISHED, DRAFT→ARCHIVED, and PUBLISHED→ARCHIVED. PUBLISHED→DRAFT and ARCHIVED→anything are firmly closed — once published, the year is immutable; once archived, it stays archived. `updateDates` is a separate procedure that only accepts DRAFT rows (to avoid invalidating a published configuration via a sneaky date edit).
- **Role gate.** `setState` looks up the caller's `User.role` from the DB on every publish/archive-of-published, requires `TENANT_ADMIN` or `BROKER_ADMIN`. Going to the DB instead of trusting the session token costs a query but means revoked admins lose publish rights immediately, not at next sign-in. `becomingPublished` branch stamps `publishedAt: new Date()` and `publishedBy: ctx.userId` atomically with the state change.
- **`policies.create` auto-creates the first BenefitYear.** Same write, nested `benefitYears: { create: [{ startDate, endDate }] }`. Default period is today (UTC midnight) → today + 365 - 1 days, all in UTC to avoid TZ drift. Brokers can edit those dates afterward via `updateDates` while the year is still DRAFT.
- **`BenefitYearsSection` component** dropped under the policy form on `/admin/clients/[id]/policies/[policyId]/edit/`. Lists every benefit year with state pill + product count + publish date. Per-row actions: Edit dates (DRAFT only, inline date inputs), Publish (DRAFT → PUBLISHED with confirm dialog), Archive (DRAFT or PUBLISHED → ARCHIVED with confirm dialog). Below the list, a small "Add benefit year" form for renewals.
- **`BenefitYearState` mirrored as a literal-union in client.** Same trick as S13's `ClientStatus` — keeps `@prisma/client` runtime out of the bundle.

**Decisions and rationale.**

1. **Re-sequenced ahead of S15.** Phase 1C ordering in the v2 plan is logical (Client → Policy → Product → Catalogue Seed → BenefitYear), but the schema makes Product depend on BenefitYear. The cheapest path to a runnable AC is BenefitYear first, Product UI second, catalogue seed last. Documented in PROGRESS.md S17 row.
2. **Default period = 12 months from today, not from policy creation date.** Same thing in practice, but tying it to `new Date()` at the moment of the create call means two policies created back-to-back share the same period — easier to reason about during testing.
3. **Role gate goes through the DB.** Session token has the role too, but a session cached pre-revocation would let a fired admin publish. The extra query is cheap in this hot-path (publish is a rare action) and leaves no stale-permission window.
4. **`updateDates` separate from `setState`.** Could have collapsed both into a single "update" mutation with optional fields, but keeping them split makes the state-immutability rule self-documenting: `updateDates` exists precisely to declare which mutations are safe on DRAFT.
5. **No optimistic lock on BenefitYear.** Policy has `versionId`; BenefitYear doesn't. Concurrent edits to BenefitYear dates are rare (it's a single broker action per renewal), and `@@unique([policyId, startDate])` catches the only real conflict.

**Verification.**

- `pnpm typecheck && pnpm check && pnpm test && pnpm build` clean.
- Existing 11/11 tests still pass.
- Build manifest: policy edit page bundle 2.51 kB → 4.07 kB (added BenefitYearsSection).

**Open items / next.**

- **S16 Catalogue seed scripts.** Seed the 12 default ProductTypes per v2 §3.5 with schemas, planSchemas, premiumStrategy refs, and Tokio Marine + Great Eastern parsing rules. Currently the `/admin/catalogue/product-types` table is empty on staging — the Product selection UI in S15 needs at least the GTL/GHS/GPA/WICI rows to render the dropdown.
- **S15 Product selection (Screen 3).** Picker UI under a BenefitYear — repeating row of (ProductType, Insurer, Pool, TPA, per-entity policyNumber). Filters: Insurer dropdown shows only insurers whose `productsSupported` array includes the selected product type's code. CUBER acceptance: 10 products spanning Tokio Marine + Zurich + Allied World.

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
