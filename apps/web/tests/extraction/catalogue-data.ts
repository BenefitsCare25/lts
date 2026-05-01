// =============================================================
// Static catalogue data for regression tests — no Prisma dependency.
//
// Mirrors the PRODUCT_TYPE_SEEDS in prisma/seeds/product-catalogue.ts
// but exports only the fields the heuristic extractor needs:
//   - productTypeStrategy mapping (code → premiumStrategy)
//   - parsing rules per product type (code → insurerCode → ParsingRules)
//
// When new product types or insurer templates are added to the seed,
// keep this file in sync. Diffs between the two files should be
// empty except for the Prisma upsert logic.
// =============================================================

import type { ParsingRules } from '../../src/server/ingestion/parser';

// ── Shared constants ──────────────────────────────────────────────────────

const STM_POLICY_ENTITIES_BLOCK = {
  sheet: 'comments',
  startRow: 21,
  endRow: 23,
  policyNumberColumn: 'A',
  legalNameColumn: 'B',
  masterRow: 21,
};

// ── Parsing rule builders ─────────────────────────────────────────────────

const TM_GENERIC_RULES: ParsingRules = {
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

function ge(
  sheet: string,
  plansBlock: { startRow: number; endRow: number; codeColumn: string },
  ratesBlock: { startRow: number; endRow: number },
  rateColumnMap?: ParsingRules['rate_column_map'],
): ParsingRules {
  return {
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
  };
}

const GE_GTL_RULES = ge(
  'GEL-GTL',
  { startRow: 21, endRow: 24, codeColumn: 'D' },
  { startRow: 29, endRow: 32 },
  { planMatch: 'D', ratePerThousand: 'F' },
);

const GE_GHS_RULES = ge(
  'GEL-GHS',
  { startRow: 22, endRow: 27, codeColumn: 'I' },
  { startRow: 32, endRow: 37 },
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
  { startRow: 22, endRow: 24, codeColumn: 'D' },
  { startRow: 30, endRow: 32 },
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

const ZURICH_GPA_RULES: ParsingRules = {
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
  rate_column_map: { planMatch: 'D', ratePerThousand: 'F' },
};

const CHUBB_GBT_RULES: ParsingRules = {
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
  rate_column_map: { planMatch: 'D', fixedAmount: 'F' },
};

const ALLIANZ_WICI_RULES: ParsingRules = {
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
  rate_column_map: { planMatch: 'D', ratePerThousand: 'F' },
};

// ── Exported catalogue tables ─────────────────────────────────────────────

export const PRODUCT_TYPE_STRATEGIES: Record<string, string> = {
  GTL: 'per_individual_salary_multiple',
  GCI: 'per_individual_fixed_sum',
  GDI: 'per_individual_salary_multiple',
  GPA: 'per_individual_fixed_sum',
  GHS: 'per_group_cover_tier',
  GMM: 'per_group_cover_tier',
  FWM: 'per_group_cover_tier',
  GP: 'per_group_cover_tier',
  SP: 'per_group_cover_tier',
  Dental: 'per_group_cover_tier',
  GBT: 'per_headcount_flat',
  WICI: 'per_individual_earnings',
};

export const PARSING_RULES_PER_PRODUCT: {
  productTypeCode: string;
  rules: Record<string, ParsingRules>;
}[] = [
  { productTypeCode: 'GTL', rules: { TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GTL_RULES } },
  { productTypeCode: 'GCI', rules: { TM_LIFE: TM_GENERIC_RULES } },
  { productTypeCode: 'GPA', rules: { ZURICH: ZURICH_GPA_RULES } },
  { productTypeCode: 'GHS', rules: { TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GHS_RULES } },
  { productTypeCode: 'GMM', rules: { TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_GMM_RULES } },
  { productTypeCode: 'GP', rules: { TM_LIFE: TM_GENERIC_RULES } },
  { productTypeCode: 'SP', rules: { TM_LIFE: TM_GENERIC_RULES, GE_LIFE: GE_SP_RULES } },
  { productTypeCode: 'Dental', rules: { TM_LIFE: TM_GENERIC_RULES } },
  { productTypeCode: 'GBT', rules: { CHUBB: CHUBB_GBT_RULES } },
  { productTypeCode: 'WICI', rules: { ALLIANZ: ALLIANZ_WICI_RULES } },
];
