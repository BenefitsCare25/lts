# Extraction regression tests

Phase 0 of the production-readiness roadmap (`claudedocs/production-readiness/01-foundation.md`).

## What this directory contains

```
apps/web/tests/extraction/
  README.md                 # this file
  regression.test.ts        # main test — loops over fixtures/<name>/, scores each
  compare-to-expected.ts    # accuracy comparator (per-field tolerance)
  types.ts                  # ExpectedFixture, AccuracyReport types
  fixtures/
    README.md               # corpus design + anonymization rules + how-to-add
    .gitignore              # guard against committing un-anonymized originals
    <fixture-name>/         # one per slip; see fixtures/README.md
```

## Running

```sh
# Replay mode (default; CI-safe; no Anthropic calls)
pnpm --filter web test -- tests/extraction/regression.test.ts

# Single fixture
pnpm --filter web test -- tests/extraction/regression.test.ts -t 'stmicro-2026'

# Record mode — re-records ai-responses.json for a fixture (real API calls!)
EXTRACTION_RECORD_AI=true \
  pnpm --filter web test -- tests/extraction/regression.test.ts -t '<fixture-name>'
```

## Accuracy targets (Phase 0 acceptance)

- Per-fixture score ≥ 0.85 (≥ 85% of fields within tolerance).
- Grand-total score ≥ 0.90 across all fixtures.
- CI fails when grand-total drops > 0.02 below `.baseline.json`.

## Outputs

- `.accuracy-report.json` written after every run (gitignored). CI uploads as artifact.
- `.baseline.json` (committed) — the floor accuracy each fixture must meet. Update intentionally when accuracy improves.
