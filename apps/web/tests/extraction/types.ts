// =============================================================
// Types for the extraction regression harness. The expected.json
// per fixture is structurally validated against ExpectedFixture
// before each test run (so a malformed fixture fails fast rather
// than silently mis-scoring).
// =============================================================

export type Tolerance = {
  /** Default 0 = exact match. Used for numbers (rates, headcounts, sums). */
  numeric?: number;
  /** Default 0 = exact match. Used for date strings (yyyy-mm-dd). 1 = ± 1 day. */
  dateDays?: number;
  /** Default 'caseSensitive'. */
  string?: 'exact' | 'caseInsensitive' | 'substringIn';
};

export type ExpectedFieldEnvelope<T> = {
  value: T | null;
  /** Override the fixture's default tolerance for this single field. */
  tolerance?: Tolerance;
  /** True if a null result is acceptable. False (default) = field is required. */
  nullable?: boolean;
};

export type ExpectedClient = {
  legalName: string;
  address: string;
  uen: string | null;
  industry: string | null;
  countryOfIncorporation: string;
  /** Fields the broker fills manually post-extraction; assert exact match here, but
   * allow null in the actual extraction (broker fills later). */
  _broker_fills?: string[];
};

export type ExpectedPolicyEntity = {
  legalName: string;
  policyNumber: string | null;
  isMaster: boolean;
  siteCode?: string | null;
  headcountEstimate?: number | null;
};

export type ExpectedBenefitYear = {
  startDate: string; // yyyy-mm-dd
  endDate: string;
};

export type ExpectedInsurer = {
  code: string;
  productCount: number;
};

export type ExpectedPlan = {
  code: string;
  name?: string; // substring-match against actual
  coverBasis:
    | 'per_cover_tier'
    | 'salary_multiple'
    | 'fixed_amount'
    | 'per_region'
    | 'earnings_based'
    | 'per_employee_flat';
  schedule?: {
    multiplier?: number;
    sumAssured?: number;
    ratePerEmployee?: number;
    dailyRoomBoard?: number;
  };
  stacksOnRawCodes?: string[];
};

export type ExpectedPremiumRate = {
  planCode: string;
  basis?: string;
  ratePerThousand?: number;
  fixedAmount?: number;
  ratePerEarningsUnit?: number;
  ratePerEmployee?: number;
  coverTier?: string | null;
};

export type ExpectedCategory = {
  category: string; // substring-match against actual
  headcount: number | null;
  sumInsured?: number | null;
};

export type ExpectedProduct = {
  productTypeCode: string;
  insurerCode: string;
  bundledWithProductCode?: string | null;
  declaredPremium?: number | null;
  /** Use _planCount instead of plans[] when the exact plan list is too verbose;
   * the comparator will then assert plans.length === _planCount. */
  _planCount?: number;
  plans?: ExpectedPlan[];
  premiumRates?: ExpectedPremiumRate[];
  categories?: ExpectedCategory[];
  /** Substrings expected in the product's extractionMeta.warnings. */
  expectedWarnings?: string[];
  /** Per-product score floor (defaults to fixture's _minScore). */
  _minScore?: number;
};

export type ExpectedReconciliation = {
  /** Set when the test asserts a precise per-product computed total. */
  perProduct?: Array<{
    productTypeCode: string;
    insurerCode: string;
    computed?: number | null;
    declared?: number | null;
    /** Acceptable status — pass if actual matches one of these. */
    status?: Array<'OK' | 'BUNDLED' | 'AI_EXTRACTION_FAILED' | 'INCOMPLETE_SCHEDULE'>;
  }>;
  grandComputed?: number | null;
  grandComputed_min?: number;
  grandComputed_max?: number;
  grandDeclared?: number | null;
};

export type ExpectedFixture = {
  schema: 'expected.v1';
  slip: {
    filename: string;
    anonymizedFrom: string; // pseudonym for the original client
    anonymizedAt: string; // yyyy-mm-dd
  };
  /** Per-fixture defaults — overridden per field via field-level tolerance. */
  tolerances?: {
    ratePerThousand?: number;
    headcount?: number;
    sumAssured?: number;
    grandComputedPct?: number;
  };
  client: ExpectedClient;
  policyEntities: ExpectedPolicyEntity[];
  benefitYear: ExpectedBenefitYear;
  insurers: ExpectedInsurer[];
  pool?: string | null;
  products: ExpectedProduct[];
  reconciliation?: ExpectedReconciliation;
  /** Substrings expected in progress.warnings (workbook-level warnings). */
  expectedWarnings?: string[];
  /** Floor accuracy score for this fixture. Default 0.85. */
  _minScore?: number;
};

// ── Accuracy report ─────────────────────────────────────────────

export type FieldComparison = {
  path: string; // e.g. 'products[0].plans[2].schedule.multiplier'
  expected: unknown;
  actual: unknown;
  pass: boolean;
  /** 1.0 = within tolerance; 0.5 = wrong-null-shape; 0.0 = mismatch. */
  score: number;
  reason?: string;
};

export type FixtureScore = {
  fixtureName: string;
  comparisons: FieldComparison[];
  /** Weighted average of comparison scores. */
  score: number;
  /** Per-section breakdown (client / entities / benefitYear / products / reconciliation / warnings). */
  perSection: Record<string, { score: number; n: number }>;
  duration_ms: number;
};

export type AccuracyReport = {
  ranAt: string; // ISO timestamp
  grandTotal: number; // weighted mean across fixtures
  fixtures: FixtureScore[];
};

// ── Recorded AI mock ─────────────────────────────────────────────

export type RecordedAiResponse = {
  /** SHA-256 of the canonical prompt (for cache lookup). */
  promptHash: string;
  /** Prose snippet of the prompt for debugging when the hash misses. */
  promptPreview: string;
  /** Raw response from the model — replayed verbatim. */
  response: unknown;
  recordedAt: string;
};

export type RecordedAiResponses = {
  schema: 'ai-responses.v1';
  fixtureName: string;
  recordedAt: string;
  model: string;
  responses: Record<string, RecordedAiResponse>; // keyed by stage::productKey
};
