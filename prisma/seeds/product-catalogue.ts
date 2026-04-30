// =============================================================
// S16: Product Catalogue seed — 12 default ProductTypes per v2 §3.5
//
// Each product type carries:
//   schema          — JSON Schema for product-instance fields
//   planSchema      — JSON Schema for plans (with stacksOn / selectionMode)
//   premiumStrategy — code mapping to premium-strategies/<code>.ts
//   parsingRules    — Excel template selectors (TM + GE only at seed time)
//   displayTemplate — minimal employee-portal card hint (S15+ adds detail)
//
// Idempotent via upsert on (tenantId, code). Safe to re-run; existing
// rows get their fields refreshed without bumping version (manual edits
// in the admin UI handle versioning).
// =============================================================

import { PRODUCT_TYPE_CODES, type ProductTypeCode } from '@insurance-saas/shared-types';
import type { PrismaClient } from '@prisma/client';

// Reusable schema fragments — these recur across every product type.
//
// The wizard's product details auto-form renders every property here as
// an editable field. Adding a property = adding a field everywhere.
// Removing a property = removing it from the wizard form on the next seed
// run. Tenant-specific overrides live on the per-product schema (the
// `extra` arg to productSchema()), not here.
const PRODUCT_BASE_PROPERTIES = {
  insurer: { type: 'string', description: 'Insurer code (matches Insurer.code)' },
  policy_number: { type: 'string', description: 'Insurer-issued policy number' },
  // Currencies default to the tenant's primary currency at apply time;
  // explicit fields support multi-currency clients without code branches.
  sum_assured_currency: {
    type: 'string',
    description: 'ISO 4217 currency code for sum-assured amounts (default: tenant primary)',
  },
  premium_currency: {
    type: 'string',
    description: 'ISO 4217 currency code for premium amounts (default: tenant primary)',
  },
  eligibility_text: { type: 'string', description: 'Plain-English eligibility blurb' },
  age_limits: {
    type: 'object',
    properties: {
      min_age_at_entry: { type: 'integer', minimum: 0, maximum: 120 },
      max_age_at_entry: { type: 'integer', minimum: 0, maximum: 120 },
      max_age_at_renewal: { type: 'integer', minimum: 0, maximum: 120 },
      // Age above which an employee requires medical underwriting,
      // regardless of sum insured. Inspro's "Age Limit for No
      // Underwriting" — distinct from `evidence_of_health_threshold`,
      // which is the SI cutoff.
      no_underwriting_max_age: { type: 'integer', minimum: 0, maximum: 120 },
    },
  },
  member_cover: {
    type: 'array',
    items: { enum: ['EO', 'ES', 'EC', 'EF'] },
    description: 'Member-cover tiers offered: EO / ES / EC / EF',
  },
  benefit_period: { type: 'string', description: 'Coverage period (e.g. "12 months")' },
  free_cover_limit: { type: 'number', minimum: 0 },
  evidence_of_health_threshold: { type: 'number', minimum: 0 },
  // Free-form broker remarks. The slip's `comments` sheet feeds this
  // when nothing structured matches; structured items go to plan-level
  // endorsements/exclusions instead.
  notes: { type: 'string', description: 'Broker remarks not captured elsewhere' },
} as const;

// Plan-level fields shared by every product type. Endorsements and
// exclusions live inside `Plan.schedule.{endorsements, exclusions}`
// per the schedule schema below — not here — so per-product-type
// schedule generators can keep the same envelope.
const PLAN_BASE_PROPERTIES = {
  code: { type: 'string', pattern: '^P[A-Z0-9]+$' },
  name: { type: 'string' },
  coverBasis: { enum: ['per_cover_tier', 'salary_multiple', 'fixed_amount', 'per_region'] },
  // Stacked rider plans: STM Plan C/D layer on top of Plan B.
  stacksOn: { type: ['string', 'null'] },
  // Flex picker mode: "broker_default" or "employee_flex" (STM Flex S/M/MC/MC2).
  selectionMode: {
    enum: ['broker_default', 'employee_flex'],
    default: 'broker_default',
  },
  effectiveFrom: { type: ['string', 'null'], format: 'date' },
  effectiveTo: { type: ['string', 'null'], format: 'date' },
} as const;

// Endorsement / Exclusion sub-schema — appended to every per-product
// schedule properties block via SCHEDULE_PLUS_REMARKS(). Codes reference
// the tenant's EndorsementCatalogue / ExclusionCatalogue; description
// is free-form for nuance the catalogue label can't carry.
const SCHEDULE_REMARK_PROPERTIES = {
  endorsements: {
    type: 'array',
    description: 'Plan-level cover additions; codes match EndorsementCatalogue.code',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['code'],
    },
  },
  exclusions: {
    type: 'array',
    description: 'Plan-level cover carve-outs; codes match ExclusionCatalogue.code',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['code'],
    },
  },
} as const;

// ── Per-product schedule property sets ─────────────────────────────────
// schedule.* under planSchema; differs by product type.

const SCHEDULE_PER_TIER_HOSPITAL = {
  dailyRoomBoard: { type: 'number', minimum: 0 },
  icuLimit: { type: 'number', minimum: 0 },
  inpatientCap: { type: 'number', minimum: 0 },
  outpatientCap: { type: 'number', minimum: 0 },
  preHospitalisationDays: { type: 'integer', default: 120 },
  postHospitalisationDays: { type: 'integer', default: 120 },
  ambulanceFees: { type: 'number', minimum: 0 },
  deathFuneralBenefit: { type: 'number', minimum: 0 },
  extensionToCoverGST: { type: 'boolean' },
};

const SCHEDULE_PER_TIER_OUTPATIENT = {
  visitLimit: { type: 'integer', minimum: 0, description: 'Visits per year per member' },
  perVisitCap: { type: 'number', minimum: 0 },
  annualCap: { type: 'number', minimum: 0 },
  copayment: { type: 'number', minimum: 0, maximum: 1, description: '0–1 fraction' },
  panelType: { enum: ['PANEL', 'NON_PANEL', 'BOTH'] },
};

const SCHEDULE_PER_TIER_DENTAL = {
  examFillingCap: { type: 'number', minimum: 0 },
  scalingPolishingCap: { type: 'number', minimum: 0 },
  majorWorkCap: { type: 'number', minimum: 0 },
  annualCap: { type: 'number', minimum: 0 },
  panelType: { enum: ['PANEL', 'NON_PANEL', 'BOTH'] },
};

const SCHEDULE_SALARY_MULTIPLE = {
  multiplier: { type: 'number', minimum: 0, description: 'Sum-assured = salary × multiplier' },
  minSumAssured: { type: 'number', minimum: 0 },
  maxSumAssured: { type: 'number', minimum: 0 },
  ratePerThousand: { type: 'number', minimum: 0 },
};

const SCHEDULE_FIXED_SUM = {
  sumAssured: { type: 'number', minimum: 0 },
  ratePerThousand: { type: 'number', minimum: 0 },
};

const SCHEDULE_PER_REGION_TRAVEL = {
  region: { enum: ['ASIA', 'WORLDWIDE_EX_US', 'WORLDWIDE'] },
  medicalCap: { type: 'number', minimum: 0 },
  evacuationCap: { type: 'number', minimum: 0 },
  baggageLossCap: { type: 'number', minimum: 0 },
  tripDelayCap: { type: 'number', minimum: 0 },
  perTripDayLimit: { type: 'integer', minimum: 0, default: 90 },
};

const SCHEDULE_WICI = {
  earningsBands: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        minAnnualEarnings: { type: 'number', minimum: 0 },
        maxAnnualEarnings: { type: 'number' },
        rate: { type: 'number', minimum: 0 },
      },
    },
  },
  medicalExpenseCap: { type: 'number', minimum: 0 },
  permanentDisabilityCap: { type: 'number', minimum: 0 },
};

// Helper to assemble a planSchema from per-product schedule properties.
// Every schedule automatically gains the shared remarks block
// (endorsements + exclusions) so the wizard renders the same UI
// across product types.
const planSchemaFor = (
  scheduleProps: Record<string, unknown>,
  schedRequired: string[] = [],
  coverBasisOverride?: string,
) => ({
  type: 'object',
  required: ['code', 'name', 'coverBasis', 'schedule'],
  properties: {
    ...PLAN_BASE_PROPERTIES,
    ...(coverBasisOverride ? { coverBasis: { enum: [coverBasisOverride] } } : {}),
    schedule: {
      type: 'object',
      properties: { ...scheduleProps, ...SCHEDULE_REMARK_PROPERTIES },
      ...(schedRequired.length > 0 ? { required: schedRequired } : {}),
    },
  },
});

const productSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  required: ['insurer', 'policy_number'],
  properties: {
    ...PRODUCT_BASE_PROPERTIES,
    ...extra,
  },
});

// ── Per-insurer × per-product parsing rules ────────────────────────────
// Cell coordinates calibrated against the STM placement slip (see
// docs/STM_PLACEMENT_SLIP_LAYOUT.md for the full reference).
//
// TM_LIFE rules remain placeholder; calibrating them needs the Balance
// and CUBER reference slips, which are not in the repo. Phase 1 ships
// structurally complete — when those land, only the constants below
// need updating, no code change.

// Tokio Marine — placeholder layout, generic across products.
const TM_GENERIC_RULES = {
  insurer_code: 'TM_LIFE',
  template_version: 'TM_2024_v1_placeholder',
  product_field_map: {
    policy_number: { sheet: 'Cover', cell: 'B5' },
    benefit_period: { sheet: 'Cover', cell: 'B7' },
    eligibility_text: { sheet: 'Cover', range: 'A12:Z14' },
  },
  plans_block: { sheet: 'Plans', startRow: 6, endRow: 100, codeColumn: 'A' },
  rates_block: { sheet: 'Rates', startRow: 4, endRow: 200 },
};

// PolicyEntities for STM live in the comments sheet rows 21-23: the
// first column has the policy number, the second the legal name, and
// the master entity is row 21. Same block referenced from every GE
// product rule; the parser dedupes on extraction.
const STM_POLICY_ENTITIES_BLOCK = {
  sheet: 'comments',
  startRow: 21,
  endRow: 23,
  policyNumberColumn: 'A',
  legalNameColumn: 'B',
  masterRow: 21,
};

// Great Eastern — STM-calibrated. Each GE product lives on its own
// sheet (`GEL-<PRODUCT>`); the common header at rows 1-17 is shared
// across the four GE sheets.
const ge = (
  sheet: string,
  plansBlock: { startRow: number; endRow: number; codeColumn: string },
  ratesBlock: { startRow: number; endRow: number },
  rateColumnMap?: object,
) => ({
  insurer_code: 'GE_LIFE',
  template_version: 'GE_STM_2026_v1',
  product_field_map: {
    policyholder_name: { sheet, cell: 'C4' },
    insured_entities_csv: { sheet, cell: 'C5' },
    address: { sheet, cell: 'C6' },
    business: { sheet, cell: 'C7' },
    period_of_insurance: { sheet, cell: 'C8' },
    insurer_name: { sheet, cell: 'C9' },
    pool_name: { sheet, cell: 'C10' },
    policy_numbers_csv: { sheet, cell: 'C11' },
    eligibility_text: { sheet, cell: 'C13' },
    eligibility_date: { sheet, cell: 'C14' },
    last_entry_age: { sheet, cell: 'C15' },
    administration_type: { sheet, cell: 'C17' },
  },
  plans_block: { sheet, ...plansBlock },
  rates_block: { sheet, ...ratesBlock },
  policy_entities_block: STM_POLICY_ENTITIES_BLOCK,
  ...(rateColumnMap ? { rate_column_map: rateColumnMap } : {}),
});

const GE_GTL_RULES = ge(
  'GEL-GTL',
  // Plans A/B/C/D in column D. C stacksOn B, D stacksOn A — encoded by
  // the basis text "additional above Plan B/A" (post-parse heuristic).
  { startRow: 21, endRow: 24, codeColumn: 'D' },
  { startRow: 29, endRow: 32 },
  // Rate row: D=plan, E=Sum Insured, F=Rate per S$1,000, G=Annual Premium.
  { planMatch: 'D', ratePerThousand: 'F' },
);

const GE_GHS_RULES = ge(
  'GEL-GHS',
  // Plans 1-6 in column I; 4/5/6 are FW variants.
  { startRow: 22, endRow: 27, codeColumn: 'I' },
  { startRow: 32, endRow: 37 },
  // Rate row: D=plan, then pairs of (rate, premium) per cover tier.
  // E=EO_rate, F=EO_premium, G=ES_rate, H=ES_premium, I=EC_rate, J=EC_premium, K=EF_rate.
  {
    planMatch: 'D',
    tiers: [
      { tier: 'EO', rateColumn: 'E' },
      { tier: 'ES', rateColumn: 'G' },
      { tier: 'EC', rateColumn: 'I' },
      { tier: 'EF', rateColumn: 'K' },
    ],
  },
);

const GE_GMM_RULES = ge(
  'GEL-GMM',
  // GMM has 3 plans listed by category description in column D. Unlike
  // GHS, GMM doesn't repeat a plan-number column on every row — col D's
  // category text is the only consistent identifier (verified against
  // the live STM slip).
  { startRow: 22, endRow: 24, codeColumn: 'D' },
  { startRow: 30, endRow: 32 },
  // Same per-tier shape as GHS.
  {
    planMatch: 'D',
    tiers: [
      { tier: 'EO', rateColumn: 'E' },
      { tier: 'ES', rateColumn: 'G' },
      { tier: 'EC', rateColumn: 'I' },
      { tier: 'EF', rateColumn: 'K' },
    ],
  },
);

const GE_SP_RULES = ge(
  'GEL-SP',
  // Same as GMM — category text in column D is the plan identifier.
  { startRow: 21, endRow: 23, codeColumn: 'D' },
  { startRow: 29, endRow: 31 },
  {
    planMatch: 'D',
    tiers: [
      { tier: 'EO', rateColumn: 'E' },
      { tier: 'ES', rateColumn: 'G' },
      { tier: 'EC', rateColumn: 'I' },
      { tier: 'EF', rateColumn: 'K' },
    ],
  },
);

// Zurich — STM-calibrated. Same header layout as GE; plan/rate blocks
// shifted slightly because Zurich omits the "Pool" row.
const ZURICH_GPA_RULES = {
  insurer_code: 'ZURICH',
  template_version: 'ZURICH_STM_2026_v1',
  product_field_map: {
    policyholder_name: { sheet: 'Zurich-GPA', cell: 'C4' },
    insured_entities_csv: { sheet: 'Zurich-GPA', cell: 'C5' },
    address: { sheet: 'Zurich-GPA', cell: 'C6' },
    business: { sheet: 'Zurich-GPA', cell: 'C7' },
    period_of_insurance: { sheet: 'Zurich-GPA', cell: 'C8' },
    insurer_name: { sheet: 'Zurich-GPA', cell: 'C9' },
    policy_numbers_csv: { sheet: 'Zurich-GPA', cell: 'C11' },
    eligibility_text: { sheet: 'Zurich-GPA', cell: 'C13' },
    eligibility_date: { sheet: 'Zurich-GPA', cell: 'C14' },
    last_entry_age: { sheet: 'Zurich-GPA', cell: 'C15' },
    administration_type: { sheet: 'Zurich-GPA', cell: 'C17' },
  },
  plans_block: { sheet: 'Zurich-GPA', startRow: 20, endRow: 23, codeColumn: 'D' },
  rates_block: { sheet: 'Zurich-GPA', startRow: 28, endRow: 31 },
  policy_entities_block: STM_POLICY_ENTITIES_BLOCK,
  // Rate row: D=plan, E=Sum Insured, F=Rate per S$1,000, G=Annual Premium.
  rate_column_map: { planMatch: 'D', ratePerThousand: 'F' },
};

// Chubb — STM-calibrated. Note the leading space in the sheet name —
// the placement slip itself contains it; we match it verbatim.
const CHUBB_GBT_RULES = {
  insurer_code: 'CHUBB',
  template_version: 'CHUBB_STM_2026_v1',
  product_field_map: {
    policyholder_name: { sheet: ' Chubb -GBT', cell: 'C4' },
    insured_entities_csv: { sheet: ' Chubb -GBT', cell: 'C5' },
    address: { sheet: ' Chubb -GBT', cell: 'C6' },
    business: { sheet: ' Chubb -GBT', cell: 'C7' },
    period_of_insurance: { sheet: ' Chubb -GBT', cell: 'C8' },
    insurer_name: { sheet: ' Chubb -GBT', cell: 'C9' },
    policy_numbers_csv: { sheet: ' Chubb -GBT', cell: 'C11' },
    eligibility_text: { sheet: ' Chubb -GBT', cell: 'C13' },
    eligibility_date: { sheet: ' Chubb -GBT', cell: 'C14' },
    last_entry_age: { sheet: ' Chubb -GBT', cell: 'C15' },
    administration_type: { sheet: ' Chubb -GBT', cell: 'C17' },
  },
  plans_block: { sheet: ' Chubb -GBT', startRow: 21, endRow: 21, codeColumn: 'D' },
  rates_block: { sheet: ' Chubb -GBT', startRow: 25, endRow: 25 },
  policy_entities_block: STM_POLICY_ENTITIES_BLOCK,
  // GBT is per_headcount_flat — col F is the rate, col G the premium.
  rate_column_map: { planMatch: 'D', fixedAmount: 'F' },
};

// Allianz — STM-calibrated. Header sits one column right (col D not C)
// and one row up from R12 (Eligibility) onwards — the "Group" row is
// indented differently from the other insurers.
const ALLIANZ_WICI_RULES = {
  insurer_code: 'ALLIANZ',
  template_version: 'ALLIANZ_STM_2026_v1',
  product_field_map: {
    policyholder_name: { sheet: 'Allianz-WICI', cell: 'D4' },
    insured_entities_csv: { sheet: 'Allianz-WICI', cell: 'D5' },
    address: { sheet: 'Allianz-WICI', cell: 'D6' },
    business: { sheet: 'Allianz-WICI', cell: 'D7' },
    period_of_insurance: { sheet: 'Allianz-WICI', cell: 'D8' },
    insurer_name: { sheet: 'Allianz-WICI', cell: 'D9' },
    policy_numbers_csv: { sheet: 'Allianz-WICI', cell: 'D10' },
    eligibility_text: { sheet: 'Allianz-WICI', cell: 'D12' },
    eligibility_date: { sheet: 'Allianz-WICI', cell: 'D13' },
    last_entry_age: { sheet: 'Allianz-WICI', cell: 'D14' },
    administration_type: { sheet: 'Allianz-WICI', cell: 'D16' },
  },
  // Allianz has one rate block per PolicyEntity. STM's slip puts the
  // Asia Pacific block at R34-38, the AMK block at R40-41, and the
  // TPY block at R43-44. The parser merges all blocks into one rate
  // array, tagging each row with its `_blockIndex`.
  plans_block: { sheet: 'Allianz-WICI', startRow: 21, endRow: 25, codeColumn: 'D' },
  rates_blocks: {
    sheet: 'Allianz-WICI',
    blocks: [
      { startRow: 34, endRow: 38, label: 'STM Asia Pacific' },
      { startRow: 40, endRow: 41, label: 'STM AMK' },
      { startRow: 43, endRow: 44, label: 'STM TPY' },
    ],
  },
  policy_entities_block: STM_POLICY_ENTITIES_BLOCK,
  // WICI is per_individual_earnings: D=category, E=Estimated Annual
  // Earnings, F=Rate, G=Annual Premium. PremiumRates emerge per
  // (plan, block) — applyToCatalogue dedupes by plan code.
  rate_column_map: { planMatch: 'D', ratePerThousand: 'F' },
};

// Compose insurer-specific parsing rules into a per-product map. Each
// product type owns the (insurer → rules) entries that apply to it,
// reflecting the reality that not every insurer underwrites every
// product, and the same insurer's slip layout differs per product.
const parsingRulesFor = (templates: Record<string, object>) => ({ templates });

// Minimal display template — employee portal renders a card with these
// fields. Full rendering hints land at S33+ when the portal is built.
const displayTemplateFor = (title: string, summaryFields: string[]) => ({
  card: { title, summaryFields },
});

// ── 12 product type definitions ─────────────────────────────────────────

interface ProductTypeSeed {
  code: ProductTypeCode;
  name: string;
  schema: object;
  planSchema: object;
  premiumStrategy:
    | 'per_individual_salary_multiple'
    | 'per_individual_fixed_sum'
    | 'per_group_cover_tier'
    | 'per_headcount_flat'
    | 'per_individual_earnings';
  parsingRules: object | null;
  displayTemplate: object;
}

export const PRODUCT_TYPE_SEEDS: ProductTypeSeed[] = [
  {
    code: 'GTL',
    name: 'Group Term Life',
    schema: productSchema({
      death_benefit_type: { enum: ['lump_sum', 'monthly_income'] },
    }),
    planSchema: planSchemaFor(SCHEDULE_SALARY_MULTIPLE, ['multiplier', 'ratePerThousand']),
    premiumStrategy: 'per_individual_salary_multiple',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GTL_RULES }),
    displayTemplate: displayTemplateFor('Term Life', ['sumAssured', 'beneficiaries']),
  },
  {
    code: 'GCI',
    name: 'Group Critical Illness',
    schema: productSchema({
      conditions_covered: { type: 'array', items: { type: 'string' } },
    }),
    planSchema: planSchemaFor(SCHEDULE_FIXED_SUM, ['sumAssured', 'ratePerThousand']),
    premiumStrategy: 'per_individual_fixed_sum',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES }),
    displayTemplate: displayTemplateFor('Critical Illness', ['sumAssured', 'conditionsCovered']),
  },
  {
    code: 'GDI',
    name: 'Group Disability Income',
    schema: productSchema({
      waiting_period_days: { type: 'integer', minimum: 0 },
      benefit_duration_months: { type: 'integer', minimum: 1 },
    }),
    planSchema: planSchemaFor(SCHEDULE_SALARY_MULTIPLE, ['multiplier', 'ratePerThousand']),
    premiumStrategy: 'per_individual_salary_multiple',
    parsingRules: null,
    displayTemplate: displayTemplateFor('Disability Income', ['monthlyBenefit', 'waitingPeriod']),
  },
  {
    code: 'GPA',
    name: 'Group Personal Accident',
    schema: productSchema({
      includes_terrorism: { type: 'boolean' },
    }),
    planSchema: planSchemaFor(SCHEDULE_FIXED_SUM, ['sumAssured', 'ratePerThousand']),
    premiumStrategy: 'per_individual_fixed_sum',
    parsingRules: parsingRulesFor({ ZURICH: ZURICH_GPA_RULES }),
    displayTemplate: displayTemplateFor('Personal Accident', ['sumAssured', 'permanentDisability']),
  },
  {
    code: 'GHS',
    name: 'Group Hospital & Surgical',
    schema: productSchema({
      tpa: { type: 'string', description: 'TPA code (matches TPA.code)' },
      panel_clinics: { type: 'boolean' },
      letter_of_guarantee: { type: 'boolean' },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_HOSPITAL, ['dailyRoomBoard'], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GHS_RULES }),
    displayTemplate: displayTemplateFor('Hospital & Surgical', ['roomBoard', 'panelStatus']),
  },
  {
    code: 'GMM',
    name: 'Group Major Medical',
    schema: productSchema({
      tpa: { type: 'string' },
      coordinates_with_ghs: { type: 'boolean', default: true },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_HOSPITAL, [], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GMM_RULES }),
    displayTemplate: displayTemplateFor('Major Medical', ['inpatientCap', 'topUpLimit']),
  },
  {
    code: 'FWM',
    name: 'Foreign Worker Medical',
    schema: productSchema({
      mom_compliant: { type: 'boolean', default: true },
      includes_inpatient_outpatient: { type: 'boolean', default: true },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_HOSPITAL, [], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: null,
    displayTemplate: displayTemplateFor('Foreign Worker Medical', ['momCompliance', 'panelStatus']),
  },
  {
    code: 'GP',
    name: 'Group Outpatient (GP)',
    schema: productSchema({
      tpa: { type: 'string' },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_OUTPATIENT, [], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES }),
    displayTemplate: displayTemplateFor('GP Visits', ['visitLimit', 'panelStatus']),
  },
  {
    code: 'SP',
    name: 'Specialist Outpatient',
    schema: productSchema({
      tpa: { type: 'string' },
      requires_referral: { type: 'boolean', default: true },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_OUTPATIENT, [], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_SP_RULES }),
    displayTemplate: displayTemplateFor('Specialist Outpatient', [
      'visitLimit',
      'referralRequired',
    ]),
  },
  {
    code: 'Dental',
    name: 'Group Dental',
    schema: productSchema({
      tpa: { type: 'string' },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_TIER_DENTAL, ['annualCap'], 'per_cover_tier'),
    premiumStrategy: 'per_group_cover_tier',
    parsingRules: parsingRulesFor({ TM_LIFE: TM_GENERIC_RULES }),
    displayTemplate: displayTemplateFor('Dental', ['annualCap', 'panelStatus']),
  },
  {
    code: 'GBT',
    name: 'Group Business Travel',
    schema: productSchema({
      max_trip_days: { type: 'integer', minimum: 1, default: 90 },
      includes_leisure_extension: { type: 'boolean', default: false },
    }),
    planSchema: planSchemaFor(SCHEDULE_PER_REGION_TRAVEL, ['region'], 'per_region'),
    premiumStrategy: 'per_headcount_flat',
    parsingRules: parsingRulesFor({ CHUBB: CHUBB_GBT_RULES }),
    displayTemplate: displayTemplateFor('Business Travel', ['region', 'medicalCap']),
  },
  {
    code: 'WICI',
    name: 'Work Injury Compensation Insurance',
    schema: productSchema({
      mom_class_codes: { type: 'array', items: { type: 'string' } },
      manual_class_workers_count: { type: 'integer', minimum: 0 },
    }),
    planSchema: planSchemaFor(SCHEDULE_WICI, ['earningsBands'], 'fixed_amount'),
    premiumStrategy: 'per_individual_earnings',
    parsingRules: parsingRulesFor({ ALLIANZ: ALLIANZ_WICI_RULES }),
    displayTemplate: displayTemplateFor('Work Injury Compensation', [
      'medicalExpenseCap',
      'permanentDisabilityCap',
    ]),
  },
];

// Defensive — surface drift between PRODUCT_TYPE_CODES and the seed list.
const SEED_CODES = new Set(PRODUCT_TYPE_SEEDS.map((s) => s.code));
for (const code of PRODUCT_TYPE_CODES) {
  if (!SEED_CODES.has(code)) {
    throw new Error(`Product type ${code} is in PRODUCT_TYPE_CODES but missing from seed list`);
  }
}

export async function seedProductCatalogueForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  for (const seed of PRODUCT_TYPE_SEEDS) {
    await prisma.productType.upsert({
      where: { tenantId_code: { tenantId, code: seed.code } },
      update: {
        name: seed.name,
        schema: seed.schema,
        planSchema: seed.planSchema,
        premiumStrategy: seed.premiumStrategy,
        parsingRules: seed.parsingRules ?? undefined,
        displayTemplate: seed.displayTemplate,
      },
      create: {
        tenantId,
        code: seed.code,
        name: seed.name,
        schema: seed.schema,
        planSchema: seed.planSchema,
        premiumStrategy: seed.premiumStrategy,
        parsingRules: seed.parsingRules ?? undefined,
        displayTemplate: seed.displayTemplate,
      },
    });
  }
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(
    `[seed] product catalogue: ${PRODUCT_TYPE_SEEDS.length} types upserted for tenant ${tenantId}`,
  );
}
