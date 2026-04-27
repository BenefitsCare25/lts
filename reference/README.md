# Reference materials

This directory contains the source-of-truth documents that drive Phase 1 development. They are read-only — never edit, only reference.

> **Required reading before any catalogue / parser / seed work:** `docs/PHASE_1_BUILD_PLAN_v2.md`. The three placement slips below are the basis for the seed data and the Three Clients acceptance test (v2 §9). Read the slip for the client you're working on before implementing parsing rules or product seeds.

## Placement slips (Excel, source of truth)

- `balance medical.xls` — simplest case (4 products: GTL, GHS, GPA, WICI). All on Tokio Marine Life. Acceptance scenario 1.
- `CUBER AI - Placement Slips 2025 (as of 24 Feb 2026).xlsx` — mid complexity (10 products spanning Tokio Marine + Zurich + Allied World). Acceptance scenario 2.
- `[REDACTED] - Placement Slips 2026_workingfile.xls` — full complexity (7 products, 6 benefit groups with compound predicates, 3 PolicyEntities, stacked Plan C/D, Flex tiers, Generali pool). Drives most of v2's schema additions. Acceptance scenario 3.

## Existing-system screenshots (Inspro)

PNG screenshots of the legacy Inspro employee-portal views, kept as reference for what the eventual employee portal (Phase 2) needs to render. **Not** a binding UX spec — just a reminder of the data each card exposes.

- `benefits.inspro.com.sg_balance.png` / `_balance (1).png` — Balance Medical employee card.
- `benefits.inspro.com.sg_cuber.png` / `_cuber (1).png` — CUBER AI employee card.
- `benefits.inspro.com.sg_stm.png` / `_stm (1).png` — STM employee card.

## How to use these in a session

1. Identify which client the story touches (Balance, CUBER, or STM).
2. Open the corresponding slip in Excel before writing parsing rules or seed scripts.
3. Cross-check the resulting product data against the slip cell-by-cell — silent drops are bugs (CLAUDE.md, "Ingestion never silently drops data").
4. The Inspro screenshots are useful when defining the `displayTemplate` JSON on a `ProductType`, but Phase 1 only needs a minimal template — Phase 2 turns that into a polished UI.
