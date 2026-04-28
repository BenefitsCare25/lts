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
const PRODUCT_BASE_PROPERTIES = {
  insurer: { type: 'string', description: 'Insurer code (matches Insurer.code)' },
  policy_number: { type: 'string', description: 'Insurer-issued policy number' },
  eligibility_text: { type: 'string', description: 'Plain-English eligibility blurb' },
  age_limits: {
    type: 'object',
    properties: {
      min_age_at_entry: { type: 'integer', minimum: 0, maximum: 120 },
      max_age_at_entry: { type: 'integer', minimum: 0, maximum: 120 },
      max_age_at_renewal: { type: 'integer', minimum: 0, maximum: 120 },
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
} as const;

// Plan-level fields shared by every product type.
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
      properties: scheduleProps,
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

// ── Tokio Marine + Great Eastern parsing rules ─────────────────────────
// CSS-like selectors against the parsed Excel grid. The S30/S31 parsers
// (Phase 1G) interpret these against insurer-specific templates.

const TM_PARSING_RULES = {
  insurer_code: 'TM_LIFE',
  template_version: 'TM_2024_v1',
  product_field_map: {
    policy_number: { sheet: 'Cover', cell: 'B5' },
    benefit_period: { sheet: 'Cover', cell: 'B7' },
    eligibility_text: { sheet: 'Cover', range: 'A12:Z14' },
  },
  plans_block: { sheet: 'Plans', startRow: 6, endRow: 100, codeColumn: 'A' },
  rates_block: { sheet: 'Rates', startRow: 4, endRow: 200 },
};

const GE_PARSING_RULES = {
  insurer_code: 'GE_LIFE',
  template_version: 'GE_2024_v1',
  product_field_map: {
    policy_number: { sheet: 'Schedule', cell: 'C8' },
    benefit_period: { sheet: 'Schedule', cell: 'C10' },
    eligibility_text: { sheet: 'Schedule', range: 'A14:Z18' },
  },
  plans_block: { sheet: 'Benefits', startRow: 8, endRow: 100, codeColumn: 'B' },
  rates_block: { sheet: 'Premium', startRow: 5, endRow: 200 },
};

// Compose insurer-specific parsing rules into a per-product map.
const parsingRulesFor = (insurers: ('TM_LIFE' | 'GE_LIFE')[]) => ({
  templates: {
    ...(insurers.includes('TM_LIFE') ? { TM_LIFE: TM_PARSING_RULES } : {}),
    ...(insurers.includes('GE_LIFE') ? { GE_LIFE: GE_PARSING_RULES } : {}),
  },
});

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
    parsingRules: parsingRulesFor(['TM_LIFE', 'GE_LIFE']),
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
    parsingRules: parsingRulesFor(['TM_LIFE']),
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
    parsingRules: null,
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
    parsingRules: parsingRulesFor(['TM_LIFE', 'GE_LIFE']),
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
    parsingRules: parsingRulesFor(['TM_LIFE', 'GE_LIFE']),
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
    parsingRules: parsingRulesFor(['TM_LIFE']),
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
    parsingRules: parsingRulesFor(['TM_LIFE', 'GE_LIFE']),
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
    parsingRules: parsingRulesFor(['TM_LIFE']),
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
    parsingRules: null,
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
    parsingRules: null,
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
