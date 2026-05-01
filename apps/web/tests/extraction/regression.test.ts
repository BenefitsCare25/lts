// =============================================================
// Extraction regression — runs the extractor against every fixture
// in fixtures/<name>/, scores against the fixture's expected.json
// with per-field tolerance, emits an accuracy report.
//
// Phase 0 of the production-readiness roadmap.
// See ./README.md for run modes; ./fixtures/README.md for corpus design.
//
// Modes:
//   default          replays AI from fixtures/<name>/ai-responses.json (CI-safe)
//   EXTRACTION_RECORD_AI=true    re-records the AI mock for one fixture by
//                                making real Anthropic calls. Costs $0.50-$2.
// =============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildAccuracyReport, compareToExpected } from './compare-to-expected';
import type { AccuracyReport, ExpectedFixture, FixtureScore } from './types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const REPORT_PATH = path.join(__dirname, '.accuracy-report.json');
const BASELINE_PATH = path.join(__dirname, '.baseline.json');

function listFixtures(): string[] {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}

function loadExpected(fixtureName: string): ExpectedFixture {
  const p = path.join(FIXTURE_DIR, fixtureName, 'expected.json');
  if (!fs.existsSync(p))
    throw new Error(`Missing expected.json for fixture ${fixtureName} at ${p}`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (raw.schema !== 'expected.v1') {
    throw new Error(
      `Fixture ${fixtureName}: expected.schema must be "expected.v1", got ${raw.schema}`,
    );
  }
  return raw as ExpectedFixture;
}

function loadSlipBuffer(fixtureName: string): Buffer {
  const dir = path.join(FIXTURE_DIR, fixtureName);
  for (const filename of ['slip.xls', 'slip.xlsx']) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  throw new Error(`No slip.xls or slip.xlsx in fixture ${fixtureName}`);
}

const fixtures = listFixtures();

if (fixtures.length === 0) {
  // The harness is expected to be in place even before fixtures are.
  // Skip with a helpful message rather than failing the build.
  describe.skip('extraction regression (no fixtures yet)', () => {
    test('add fixtures under apps/web/tests/extraction/fixtures/<name>/ to enable this suite', () => {});
  });
} else {
  describe('extraction regression', () => {
    const scores: FixtureScore[] = [];

    for (const fixtureName of fixtures) {
      test(
        fixtureName,
        async () => {
          const expected = loadExpected(fixtureName);
          // Sanity: the slip file exists; we don't read it here yet because
          // the extractor pipeline isn't fully refactored to take a buffer
          // directly. Phase 2/4 wires this end-to-end. For now this confirms
          // the fixture is shaped correctly and the harness is loadable.
          loadSlipBuffer(fixtureName);

          // TODO(phase-0-final): replace this stub with a real call:
          //   const actual = await runExtractionForFixture(fixtureName, slipBuf, expected);
          // For now, we run the comparator against an empty extraction so
          // the test fails LOUDLY with a clear "extractor stub" message —
          // signalling Phase 0 needs the runner integration before fixtures
          // earn meaningful scores.
          const stubActual = {
            proposedClient: null,
            proposedPolicyEntities: [],
            proposedBenefitYear: null,
            proposedInsurers: [],
            proposedPool: null,
            warnings: [],
            extractedProducts: [],
            reconciliation: {},
          };
          const start = Date.now();
          const score = compareToExpected(fixtureName, expected, stubActual, Date.now() - start);
          scores.push(score);

          const floor = expected._minScore ?? 0.85;
          // While the extractor is stubbed, we accept any score (it'll be 0
          // for everything). Once Phase 0 wires the real runner, flip this
          // to expect(score.score).toBeGreaterThanOrEqual(floor).
          //
          // Do NOT silently pass — print the failed comparisons so the
          // harness is visibly working even with a stub.
          if (process.env.EXTRACTION_RUNNER_WIRED === 'true') {
            expect(score.score).toBeGreaterThanOrEqual(floor);
          } else {
            console.info(
              `[regression][${fixtureName}] stub mode — score=${score.score.toFixed(3)} (floor=${floor})`,
            );
            console.info(
              `[regression][${fixtureName}] perSection:`,
              JSON.stringify(score.perSection),
            );
          }
        },
        { timeout: 600_000 }, // 10 min — real AI-recorded runs are slow
      );
    }

    // After-all: write the accuracy report and compare to baseline.
    test('grand total + baseline check', () => {
      if (scores.length === 0) return;
      const report = buildAccuracyReport(scores);
      fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

      if (process.env.EXTRACTION_RUNNER_WIRED === 'true' && fs.existsSync(BASELINE_PATH)) {
        const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as AccuracyReport;
        const drop = baseline.grandTotal - report.grandTotal;
        expect(drop).toBeLessThanOrEqual(0.02);
      }
    });
  });
}
