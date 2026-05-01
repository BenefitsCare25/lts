// =============================================================
// Comparator — diff actual extraction output vs ExpectedFixture
// with per-field tolerance. Returns a FixtureScore with per-section
// breakdown so the regression report can highlight WHICH section
// regressed, not just the grand total.
//
// Section weights (for the weighted average):
//   client:          1.0
//   policyEntities:  1.0
//   benefitYear:     1.0
//   insurers:        1.0
//   pool:            0.5
//   products:        2.0   ← bulk of the work; doubles the weight
//   reconciliation:  3.0   ← the correctness gate; triples the weight
//   warnings:        0.5
// =============================================================

import type {
  AccuracyReport,
  ExpectedFixture,
  ExpectedPlan,
  ExpectedProduct,
  FieldComparison,
  FixtureScore,
} from './types';

const SECTION_WEIGHTS: Record<string, number> = {
  client: 1.0,
  policyEntities: 1.0,
  benefitYear: 1.0,
  insurers: 1.0,
  pool: 0.5,
  products: 2.0,
  reconciliation: 3.0,
  warnings: 0.5,
};

const DEFAULT_TOLERANCES = {
  ratePerThousand: 0.01,
  headcount: 0,
  sumAssured: 1,
  grandComputedPct: 5,
};

type ActualExtraction = {
  // Loose shape — matches what extractFromWorkbook + the runner produces.
  // We use unknown for the deep parts and narrow at comparison time, so a
  // schema drift surfaces as a comparator failure not a TypeScript error.
  proposedClient: unknown;
  proposedPolicyEntities: unknown[];
  proposedBenefitYear: unknown;
  proposedInsurers: unknown[];
  proposedPool: unknown;
  warnings: string[];
  extractedProducts: unknown[];
  reconciliation: unknown;
};

export function compareToExpected(
  fixtureName: string,
  expected: ExpectedFixture,
  actual: ActualExtraction,
  durationMs: number,
): FixtureScore {
  const comparisons: FieldComparison[] = [];
  const perSection: Record<string, { score: number; n: number }> = {};

  function record(section: string, comp: FieldComparison) {
    comparisons.push(comp);
    perSection[section] ??= { score: 0, n: 0 };
    perSection[section].score += comp.score;
    perSection[section].n += 1;
  }

  // ── Client section ───────────────────────────────────────────
  const cli = (actual.proposedClient ?? {}) as Record<string, unknown>;
  recordStringEq(record, 'client', 'client.legalName', expected.client.legalName, cli.legalName);
  recordStringEq(
    record,
    'client',
    'client.address',
    expected.client.address,
    cli.address,
    'caseInsensitive',
  );
  recordStringEq(
    record,
    'client',
    'client.countryOfIncorporation',
    expected.client.countryOfIncorporation,
    cli.countryOfIncorporation,
  );
  recordNullableString(record, 'client', 'client.uen', expected.client.uen, cli.uen);
  recordNullableString(record, 'client', 'client.industry', expected.client.industry, cli.industry);

  // ── Policy entities ───────────────────────────────────────────
  const actualEntities = (actual.proposedPolicyEntities ?? []) as Array<Record<string, unknown>>;
  recordEq(
    record,
    'policyEntities',
    'policyEntities.length',
    expected.policyEntities.length,
    actualEntities.length,
  );
  for (const [i, exp] of expected.policyEntities.entries()) {
    const got = actualEntities[i];
    if (!got) {
      record('policyEntities', {
        path: `policyEntities[${i}]`,
        expected: exp,
        actual: null,
        pass: false,
        score: 0,
      });
      continue;
    }
    recordStringEq(
      record,
      'policyEntities',
      `policyEntities[${i}].legalName`,
      exp.legalName,
      got.legalName,
    );
    recordEq(
      record,
      'policyEntities',
      `policyEntities[${i}].policyNumber`,
      exp.policyNumber,
      got.policyNumber ?? null,
    );
    recordEq(record, 'policyEntities', `policyEntities[${i}].isMaster`, exp.isMaster, got.isMaster);
    if (exp.siteCode !== undefined) {
      recordEq(
        record,
        'policyEntities',
        `policyEntities[${i}].siteCode`,
        exp.siteCode,
        got.siteCode ?? null,
      );
    }
    if (exp.headcountEstimate !== undefined) {
      recordNumberEq(
        record,
        'policyEntities',
        `policyEntities[${i}].headcountEstimate`,
        exp.headcountEstimate,
        got.headcountEstimate as number | null,
        expected.tolerances?.headcount ?? DEFAULT_TOLERANCES.headcount,
      );
    }
  }

  // ── Benefit year ─────────────────────────────────────────────
  const by = (actual.proposedBenefitYear ?? {}) as Record<string, unknown>;
  recordStringEq(
    record,
    'benefitYear',
    'benefitYear.startDate',
    expected.benefitYear.startDate,
    by.startDate,
  );
  recordStringEq(
    record,
    'benefitYear',
    'benefitYear.endDate',
    expected.benefitYear.endDate,
    by.endDate,
  );

  // ── Insurers ─────────────────────────────────────────────────
  const actualInsurers = (actual.proposedInsurers ?? []) as Array<Record<string, unknown>>;
  for (const exp of expected.insurers) {
    const got = actualInsurers.find((i) => (i.code as string) === exp.code);
    if (!got) {
      record('insurers', {
        path: `insurers[${exp.code}]`,
        expected: exp.code,
        actual: 'missing',
        pass: false,
        score: 0,
        reason: 'insurer code not in actual extraction',
      });
      continue;
    }
    recordEq(
      record,
      'insurers',
      `insurers[${exp.code}].productCount`,
      exp.productCount,
      got.productCount,
    );
  }

  // ── Pool ─────────────────────────────────────────────────────
  if (expected.pool !== undefined) {
    const actualPool = (actual.proposedPool as { name?: string } | null)?.name ?? null;
    recordEq(record, 'pool', 'pool.name', expected.pool, actualPool);
  }

  // ── Products ─────────────────────────────────────────────────
  const actualProducts = (actual.extractedProducts ?? []) as Array<Record<string, unknown>>;
  recordEq(record, 'products', 'products.length', expected.products.length, actualProducts.length);
  for (const exp of expected.products) {
    const got = actualProducts.find(
      (p) => p.productTypeCode === exp.productTypeCode && p.insurerCode === exp.insurerCode,
    );
    if (!got) {
      record('products', {
        path: `products[${exp.productTypeCode}::${exp.insurerCode}]`,
        expected: 'present',
        actual: 'missing',
        pass: false,
        score: 0,
      });
      continue;
    }
    compareProduct(record, exp, got, expected.tolerances ?? {});
  }

  // ── Reconciliation ───────────────────────────────────────────
  if (expected.reconciliation) {
    const actualRecon = (actual.reconciliation ?? {}) as Record<string, unknown>;
    if (
      expected.reconciliation.grandComputed_min !== undefined &&
      expected.reconciliation.grandComputed_max !== undefined
    ) {
      const gc = (actualRecon.grandComputed as number | null) ?? null;
      const inRange =
        gc !== null &&
        gc >= expected.reconciliation.grandComputed_min &&
        gc <= expected.reconciliation.grandComputed_max;
      record('reconciliation', {
        path: 'reconciliation.grandComputed',
        expected: `[${expected.reconciliation.grandComputed_min}, ${expected.reconciliation.grandComputed_max}]`,
        actual: gc,
        pass: inRange,
        score: inRange ? 1 : 0,
      });
    } else if (expected.reconciliation.grandComputed !== undefined) {
      const tolPct = expected.tolerances?.grandComputedPct ?? DEFAULT_TOLERANCES.grandComputedPct;
      recordPercentEq(
        record,
        'reconciliation',
        'reconciliation.grandComputed',
        expected.reconciliation.grandComputed,
        actualRecon.grandComputed as number | null,
        tolPct,
      );
    }
    for (const expRow of expected.reconciliation.perProduct ?? []) {
      const gotRow = ((actualRecon.perProduct as Array<Record<string, unknown>>) ?? []).find(
        (r) => r.productTypeCode === expRow.productTypeCode && r.insurerCode === expRow.insurerCode,
      );
      if (!gotRow) {
        record('reconciliation', {
          path: `reconciliation.perProduct[${expRow.productTypeCode}::${expRow.insurerCode}]`,
          expected: 'present',
          actual: 'missing',
          pass: false,
          score: 0,
        });
        continue;
      }
      if (expRow.status) {
        const matched = expRow.status.includes(gotRow.status as never);
        record('reconciliation', {
          path: `reconciliation.perProduct[${expRow.productTypeCode}::${expRow.insurerCode}].status`,
          expected: expRow.status.join(' | '),
          actual: gotRow.status,
          pass: matched,
          score: matched ? 1 : 0,
        });
      }
    }
  }

  // ── Warnings ─────────────────────────────────────────────────
  for (const expectedSubstring of expected.expectedWarnings ?? []) {
    const matched = (actual.warnings ?? []).some((w) =>
      w.toLowerCase().includes(expectedSubstring.toLowerCase()),
    );
    record('warnings', {
      path: `warnings[~"${expectedSubstring.slice(0, 40)}…"]`,
      expected: 'present',
      actual: matched ? 'present' : 'missing',
      pass: matched,
      score: matched ? 1 : 0,
    });
  }

  // ── Compute weighted score ────────────────────────────────────
  let weighted = 0;
  let totalWeight = 0;
  for (const [section, { score, n }] of Object.entries(perSection)) {
    if (n === 0) continue;
    const weight = (SECTION_WEIGHTS[section] ?? 1.0) * n;
    weighted += (score / n) * weight;
    totalWeight += weight;
  }
  const finalScore = totalWeight > 0 ? weighted / totalWeight : 0;

  return {
    fixtureName,
    comparisons,
    score: finalScore,
    perSection: Object.fromEntries(
      Object.entries(perSection).map(([k, v]) => [
        k,
        { score: v.n > 0 ? v.score / v.n : 0, n: v.n },
      ]),
    ),
    duration_ms: durationMs,
  };
}

// ── Helper recorders ───────────────────────────────────────────

function recordEq(
  record: (section: string, comp: FieldComparison) => void,
  section: string,
  path: string,
  expected: unknown,
  actual: unknown,
) {
  const pass = expected === actual;
  record(section, { path, expected, actual, pass, score: pass ? 1 : 0 });
}

function recordNumberEq(
  record: (section: string, comp: FieldComparison) => void,
  section: string,
  path: string,
  expected: number | null,
  actual: number | null,
  tolerance: number,
) {
  if (expected == null && actual == null) {
    record(section, { path, expected, actual, pass: true, score: 1 });
    return;
  }
  if (expected == null || actual == null) {
    record(section, { path, expected, actual, pass: false, score: 0.5, reason: 'one side null' });
    return;
  }
  const diff = Math.abs(expected - actual);
  const pass = diff <= tolerance;
  record(section, {
    path,
    expected,
    actual,
    pass,
    score: pass ? 1 : 0,
    ...(pass ? {} : { reason: `diff ${diff} > tolerance ${tolerance}` }),
  });
}

function recordPercentEq(
  record: (section: string, comp: FieldComparison) => void,
  section: string,
  path: string,
  expected: number | null,
  actual: number | null,
  tolerancePct: number,
) {
  if (expected == null && actual == null) {
    record(section, { path, expected, actual, pass: true, score: 1 });
    return;
  }
  if (expected == null || actual == null) {
    record(section, { path, expected, actual, pass: false, score: 0.5, reason: 'one side null' });
    return;
  }
  const pct =
    expected === 0
      ? actual === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs((actual - expected) / expected) * 100;
  const pass = pct <= tolerancePct;
  record(section, {
    path,
    expected,
    actual,
    pass,
    score: pass ? 1 : 0,
    ...(pass ? {} : { reason: `${pct.toFixed(2)}% drift > ${tolerancePct}%` }),
  });
}

function recordStringEq(
  record: (section: string, comp: FieldComparison) => void,
  section: string,
  path: string,
  expected: string,
  actual: unknown,
  mode: 'exact' | 'caseInsensitive' | 'substringIn' = 'exact',
) {
  if (typeof actual !== 'string') {
    record(section, { path, expected, actual, pass: false, score: 0, reason: 'not a string' });
    return;
  }
  let pass: boolean;
  if (mode === 'caseInsensitive') {
    pass = expected.toLowerCase() === actual.toLowerCase();
  } else if (mode === 'substringIn') {
    pass = actual.toLowerCase().includes(expected.toLowerCase());
  } else {
    pass = expected === actual;
  }
  record(section, { path, expected, actual, pass, score: pass ? 1 : 0 });
}

function recordNullableString(
  record: (section: string, comp: FieldComparison) => void,
  section: string,
  path: string,
  expected: string | null,
  actual: unknown,
) {
  if (expected === null) {
    const pass = actual === null || actual === undefined || actual === '';
    record(section, { path, expected, actual, pass, score: pass ? 1 : 0 });
    return;
  }
  recordStringEq(record, section, path, expected, actual);
}

// ── Product comparison ─────────────────────────────────────────

function compareProduct(
  record: (section: string, comp: FieldComparison) => void,
  exp: ExpectedProduct,
  actual: Record<string, unknown>,
  tol: NonNullable<ExpectedFixture['tolerances']>,
) {
  const prefix = `products[${exp.productTypeCode}::${exp.insurerCode}]`;

  if (exp.bundledWithProductCode !== undefined) {
    recordEq(
      record,
      'products',
      `${prefix}.bundledWithProductCode`,
      exp.bundledWithProductCode,
      actual.bundledWithProductCode ?? null,
    );
  }

  if (exp.declaredPremium !== undefined) {
    const declared =
      (
        (actual.header as Record<string, unknown>)?.declaredPremium as
          | { value?: number }
          | undefined
      )?.value ?? null;
    recordPercentEq(
      record,
      'products',
      `${prefix}.header.declaredPremium`,
      exp.declaredPremium,
      declared,
      1,
    );
  }

  const plans = (actual.plans as Array<Record<string, unknown>>) ?? [];
  if (exp._planCount !== undefined) {
    recordEq(record, 'products', `${prefix}.plans.length`, exp._planCount, plans.length);
  }
  for (const expPlan of exp.plans ?? []) {
    const got = plans.find((p) => p.code === expPlan.code);
    if (!got) {
      record('products', {
        path: `${prefix}.plans[${expPlan.code}]`,
        expected: 'present',
        actual: 'missing',
        pass: false,
        score: 0,
      });
      continue;
    }
    comparePlan(record, `${prefix}.plans[${expPlan.code}]`, expPlan, got);
  }

  const rates = (actual.premiumRates as Array<Record<string, unknown>>) ?? [];
  for (const expRate of exp.premiumRates ?? []) {
    const planLookup = plans.find((p) => p.code === expRate.planCode);
    const planRawCode = planLookup?.rawCode as string | undefined;
    const got = rates.find(
      (r) => r.planRawCode === planRawCode || r.planRawCode === expRate.planCode,
    );
    if (!got) {
      record('products', {
        path: `${prefix}.premiumRates[${expRate.planCode}]`,
        expected: 'present',
        actual: 'missing',
        pass: false,
        score: 0,
      });
      continue;
    }
    if (expRate.ratePerThousand !== undefined) {
      recordNumberEq(
        record,
        'products',
        `${prefix}.premiumRates[${expRate.planCode}].ratePerThousand`,
        expRate.ratePerThousand,
        got.ratePerThousand as number | null,
        tol.ratePerThousand ?? DEFAULT_TOLERANCES.ratePerThousand,
      );
    }
    if (expRate.fixedAmount !== undefined) {
      recordNumberEq(
        record,
        'products',
        `${prefix}.premiumRates[${expRate.planCode}].fixedAmount`,
        expRate.fixedAmount,
        got.fixedAmount as number | null,
        1,
      );
    }
    if (expRate.basis !== undefined) {
      recordEq(
        record,
        'products',
        `${prefix}.premiumRates[${expRate.planCode}].basis`,
        expRate.basis,
        got.basis ?? 'per_thousand_si',
      );
    }
  }

  const categories =
    ((actual.eligibility as Record<string, unknown>)?.categories as Array<
      Record<string, unknown>
    >) ?? [];
  for (const expCat of exp.categories ?? []) {
    const got = categories.find(
      (c) => typeof c.category === 'string' && (c.category as string).includes(expCat.category),
    );
    if (!got) {
      record('products', {
        path: `${prefix}.categories[~"${expCat.category}"]`,
        expected: 'present',
        actual: 'missing',
        pass: false,
        score: 0,
      });
      continue;
    }
    if (expCat.headcount !== undefined) {
      recordNumberEq(
        record,
        'products',
        `${prefix}.categories[~"${expCat.category}"].headcount`,
        expCat.headcount,
        got.headcount as number | null,
        tol.headcount ?? DEFAULT_TOLERANCES.headcount,
      );
    }
    if (expCat.sumInsured !== undefined) {
      recordNumberEq(
        record,
        'products',
        `${prefix}.categories[~"${expCat.category}"].sumInsured`,
        expCat.sumInsured,
        got.sumInsured as number | null,
        tol.sumAssured ?? DEFAULT_TOLERANCES.sumAssured,
      );
    }
  }

  for (const expSubstring of exp.expectedWarnings ?? []) {
    const meta = (actual.extractionMeta as Record<string, unknown>) ?? {};
    const warnings = (meta.warnings as string[]) ?? [];
    const matched = warnings.some((w) => w.toLowerCase().includes(expSubstring.toLowerCase()));
    record('products', {
      path: `${prefix}.warnings[~"${expSubstring.slice(0, 40)}…"]`,
      expected: 'present',
      actual: matched ? 'present' : 'missing',
      pass: matched,
      score: matched ? 1 : 0,
    });
  }
}

function comparePlan(
  record: (section: string, comp: FieldComparison) => void,
  prefix: string,
  exp: ExpectedPlan,
  actual: Record<string, unknown>,
) {
  recordEq(record, 'products', `${prefix}.coverBasis`, exp.coverBasis, actual.coverBasis);
  if (exp.name) {
    recordStringEq(record, 'products', `${prefix}.name`, exp.name, actual.name, 'substringIn');
  }
  if (exp.schedule) {
    const sched = (actual.schedule ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(exp.schedule)) {
      if (value === undefined) continue;
      recordNumberEq(
        record,
        'products',
        `${prefix}.schedule.${key}`,
        value,
        sched[key] as number | null,
        0.01,
      );
    }
  }
  if (exp.stacksOnRawCodes !== undefined) {
    const actualStacks =
      (actual.stacksOnRawCodes as string[] | undefined) ??
      (actual.stacksOnRawCode ? [actual.stacksOnRawCode as string] : []);
    const sortedExp = [...exp.stacksOnRawCodes].sort();
    const sortedAct = [...actualStacks].sort();
    const pass =
      sortedExp.length === sortedAct.length && sortedExp.every((v, i) => v === sortedAct[i]);
    record('products', {
      path: `${prefix}.stacksOnRawCodes`,
      expected: sortedExp,
      actual: sortedAct,
      pass,
      score: pass ? 1 : 0,
    });
  }
}

// ── Grand-total aggregator ─────────────────────────────────────

export function buildAccuracyReport(scores: FixtureScore[]): AccuracyReport {
  const grandTotal =
    scores.length === 0 ? 0 : scores.reduce((acc, s) => acc + s.score, 0) / scores.length;
  return {
    ranAt: new Date().toISOString(),
    grandTotal,
    fixtures: scores,
  };
}
