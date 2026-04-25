import type { ProductTypeSeed } from "./types";

/**
 * Group Personal Accident (GPA) — v1.
 *
 * Phase 1 keeps GPA simple: per-individual sum assured *or* salary multiple,
 * with the four canonical accident benefits. Modelled on the CUBER Zurich
 * GPA sheet.
 */
export const gpa: ProductTypeSeed = {
  code: "GPA",
  name: "Group Personal Accident",
  category: "life",
  description:
    "Accidental death, TPD, medical expenses, and weekly income cover. Sum assured per individual or as a salary multiple.",
  version: 1,
  effectiveFrom: "2025-01-01",
  calcStrategy: "per_individual_fixed_sum",

  schemaProduct: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["insurer", "policy_number", "eligibility", "basis_of_cover"],
    properties: {
      insurer: { type: "string" },
      policy_number: { type: "string" },
      pool: { type: ["string", "null"] },
      eligibility: { type: "string" },
      last_entry_age: { type: "integer", minimum: 0 },
      employee_age_limit: { type: "integer", minimum: 0 },
      basis_of_cover: { enum: ["per_individual_sum_assured", "salary_multiple"] },
      coverage_scope: {
        enum: ["24_hours_worldwide", "working_hours_only", "while_on_business_travel"],
        default: "24_hours_worldwide",
      },
      premium_currency: { type: "string", default: "SGD" },
    },
  },

  schemaPlan: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["plan_id", "name"],
    properties: {
      plan_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      name: { type: "string" },
      sum_assured: { type: "number", minimum: 0 },
      salary_multiplier: { type: "number", minimum: 0 },
      min_sum_assured: { type: "number" },
      max_sum_assured: { type: "number" },
    },
  },

  schemaSchedule: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      accidental_death: {
        type: "object",
        properties: {
          covered: { type: "boolean", default: true },
          percent_of_sum_assured: { type: "number", default: 100 },
        },
      },
      total_permanent_disability: {
        type: "object",
        properties: {
          covered: { type: "boolean", default: true },
          percent_of_sum_assured: { type: "number", default: 100 },
        },
      },
      medical_expenses: {
        type: "object",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          per_accident: { type: "boolean", default: true },
        },
      },
      weekly_income_benefit: {
        type: "object",
        properties: {
          weekly_amount_by_plan: { type: "object", additionalProperties: { type: "number" } },
          max_weeks: { type: "integer", default: 104 },
          waiting_days: { type: "integer", default: 7 },
        },
      },
      double_indemnity_public_transport: { type: "boolean", default: false },
    },
  },

  schemaRate: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      calculation_type: { enum: ["per_individual", "per_group"] },
      rates: {
        type: "array",
        items: {
          type: "object",
          required: ["plan_id", "annual_premium"],
          properties: {
            plan_id: { type: "string" },
            benefit_group_id: { type: ["string", "null"] },
            rate_per_1000: { type: "number", minimum: 0 },
            annual_premium: { type: "number", minimum: 0 },
          },
        },
      },
    },
  },

  ingestionTemplate: {
    sheet_matchers: ["GPA", "Group Personal Accident", "Personal Accident"],
    header_fields: [
      { path: "insurer", row_label: "Insurer :", column_offset: 1 },
      { path: "policy_number", row_label: "Policy No. :", column_offset: 1 },
      { path: "eligibility", row_label: "Eligibility :", column_offset: 1 },
      { path: "basis_of_cover", row_label: "Basis of Cover :", column_offset: 1 },
    ],
    schedule_section: {
      start_marker: "SCHEDULE OF BENEFITS",
      line_items: [
        {
          path: "schedule.medical_expenses.limit_by_plan",
          row_label_patterns: ["Medical Expenses"],
          value_type: "number",
        },
        {
          path: "schedule.weekly_income_benefit.weekly_amount_by_plan",
          row_label_patterns: ["Weekly Income", "Temporary Total Disablement"],
          value_type: "number",
        },
      ],
    },
  },

  displayTemplate: {
    sections: [
      {
        title: "Accident benefits",
        items: [
          {
            label: "Accidental death",
            path: "schedule.accidental_death.percent_of_sum_assured",
            format: "currency_sgd",
          },
          {
            label: "Medical expenses",
            path: "schedule.medical_expenses.limit_by_plan.{plan_id}",
            format: "currency_sgd",
          },
          {
            label: "Weekly income",
            path: "schedule.weekly_income_benefit.weekly_amount_by_plan.{plan_id}",
            format: "currency_sgd",
          },
        ],
      },
    ],
  },
};
