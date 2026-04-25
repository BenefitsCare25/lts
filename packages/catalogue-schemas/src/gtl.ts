import type { ProductTypeSeed } from "./types";

/**
 * Group Term Life (GTL) — v1.
 *
 * Schemas mirror `docs/architecture.md` §6, derived from the CUBER AI
 * placement slip's GTL sheet.
 */
export const gtl: ProductTypeSeed = {
  code: "GTL",
  name: "Group Term Life",
  category: "life",
  description:
    "Death and TPD cover with a sum-assured basis (fixed or salary multiple). Per-individual rate per $1,000.",
  version: 1,
  effectiveFrom: "2025-01-01",
  calcStrategy: "per_individual_salary_multiple",

  schemaProduct: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["insurer", "policy_number", "eligibility", "last_entry_age"],
    properties: {
      insurer: { type: "string" },
      policy_number: { type: "string" },
      pool: { type: ["string", "null"] },
      eligibility: { type: "string" },
      last_entry_age: { type: "integer", minimum: 0 },
      employee_age_limit: { type: "integer", minimum: 0 },
      sum_assured_currency: { type: "string", default: "SGD" },
      no_evidence_limit: {
        type: "number",
        description: "Above this sum assured, underwriting required.",
      },
      maximum_limit_per_life: { type: "number" },
    },
  },

  schemaPlan: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["plan_id", "name", "basis_type"],
    oneOf: [
      {
        properties: {
          plan_id: { type: "string" },
          name: { type: "string" },
          basis_type: { const: "fixed" },
          sum_assured: { type: "number", minimum: 0 },
        },
        required: ["plan_id", "name", "basis_type", "sum_assured"],
      },
      {
        properties: {
          plan_id: { type: "string" },
          name: { type: "string" },
          basis_type: { const: "salary_multiple" },
          multiplier: { type: "number", minimum: 0 },
          salary_basis: { enum: ["last_drawn_monthly", "annual"] },
          min_sum_assured: { type: "number" },
          max_sum_assured: { type: "number" },
        },
        required: ["plan_id", "name", "basis_type", "multiplier", "salary_basis"],
      },
    ],
  },

  schemaSchedule: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      death_benefit: { type: "boolean", default: true },
      tpd_benefit: { type: "boolean", default: true },
      tpd_max_age: { type: "integer", default: 70 },
      family_income_benefit: {
        type: "object",
        properties: {
          monthly_percent_of_sum_assured: { type: "number" },
          months: { type: "integer", default: 12 },
        },
      },
      terminal_illness_benefit: { type: "boolean", default: true },
      extended_benefit: {
        type: "object",
        properties: {
          months: { type: "integer" },
          termination_window_months: { type: "integer" },
        },
      },
      repatriation_benefit: {
        type: "object",
        properties: {
          max_amount: { type: "number" },
        },
      },
    },
  },

  schemaRate: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      calculation_type: { const: "per_individual" },
      distinct_benefit_group_pricing: { type: "boolean" },
      rates: {
        type: "array",
        items: {
          type: "object",
          required: ["benefit_group_id", "rate_per_1000"],
          properties: {
            benefit_group_id: { type: "string" },
            rate_per_1000: { type: "number", minimum: 0 },
          },
        },
      },
    },
  },

  ingestionTemplate: {
    sheet_matchers: ["GTL", "Group Term Life"],
    header_fields: [
      { path: "insurer", row_label: "Insurer :", column_offset: 1 },
      { path: "policy_number", row_label: "Policy No. :", column_offset: 1 },
      { path: "eligibility", row_label: "Eligibility :", column_offset: 1 },
      {
        path: "last_entry_age",
        row_label: "Last entry age :",
        column_offset: 1,
        extract: "first_integer",
      },
      {
        path: "no_evidence_limit",
        row_label: "No Evidence Limit :",
        column_offset: 1,
        extract: "first_number",
      },
    ],
  },

  displayTemplate: {
    sections: [
      {
        title: "Life cover",
        items: [
          { label: "Death benefit", path: "schedule.death_benefit", format: "boolean_yes_no" },
          { label: "TPD benefit", path: "schedule.tpd_benefit", format: "boolean_yes_no" },
          { label: "TPD maximum age", path: "schedule.tpd_max_age", format: "days" },
        ],
      },
    ],
  },
};
