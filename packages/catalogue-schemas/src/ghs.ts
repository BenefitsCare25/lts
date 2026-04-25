import type { ProductTypeSeed } from "./types";

/**
 * Group Hospital and Surgical (GHS) — v1.
 *
 * Schemas mirror the structure described in `docs/architecture.md` §5,
 * derived from the CUBER AI placement slip.
 */
export const ghs: ProductTypeSeed = {
  code: "GHS",
  name: "Group Hospital and Surgical",
  category: "health",
  description:
    "Inpatient hospitalisation and outpatient cover, with per-plan ward classes and an EO/ES/EC/EF rate grid.",
  version: 1,
  effectiveFrom: "2025-01-01",
  calcStrategy: "per_group_coverage_lookup",

  schemaProduct: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["insurer", "policy_number", "eligibility", "last_entry_age", "administration_basis"],
    properties: {
      insurer: { type: "string" },
      policy_number: { type: "string" },
      pool: { type: ["string", "null"] },
      eligibility: { type: "string", description: "Natural-language eligibility clause" },
      age_limit_no_uw: { type: "integer", minimum: 0 },
      last_entry_age: { type: "integer", minimum: 0 },
      employee_age_limit: { type: "integer", minimum: 0 },
      administration_basis: { enum: ["name", "headcount"] },
      premium_currency: { type: "string", default: "SGD" },
      gst_extension: { type: "boolean", default: true },
      tpa: { type: ["string", "null"] },
      claim_data_feed: { type: ["string", "null"] },
    },
  },

  schemaPlan: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["plan_id", "name", "ward_class"],
    properties: {
      plan_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      name: { type: "string" },
      ward_class: {
        enum: ["1_bed_private", "2_bed_private", "4_bed_restructured", "b1", "b2", "c"],
      },
    },
  },

  schemaSchedule: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["room_and_board", "icu", "inpatient_expenses", "outpatient_expenses"],
    properties: {
      per_disability_qualification_days: {
        type: "integer",
        description: "Days after discharge before a new disability resets",
      },
      room_and_board: {
        type: "object",
        required: ["ward_by_plan", "max_days"],
        properties: {
          ward_by_plan: {
            type: "object",
            additionalProperties: {
              enum: ["1_bed_private", "2_bed_private", "4_bed_restructured", "b1", "b2", "c"],
            },
          },
          max_days: { type: "integer", default: 120 },
        },
      },
      icu: {
        type: "object",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          max_days: { type: "integer", default: 30 },
        },
      },
      inpatient_expenses: {
        type: "object",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          includes_surgical_implants: { type: "boolean" },
          surgical_schedule_threshold: { type: "number" },
        },
      },
      outpatient_expenses: {
        type: "object",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          pre_hospitalisation_days: { type: "integer" },
          post_hospitalisation_days: { type: "integer" },
        },
      },
      emergency_accidental_outpatient: {
        type: "object",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          treatment_window_hours: { type: "integer", default: 24 },
          followup_days: { type: "integer", default: 31 },
        },
      },
      outpatient_treatments: {
        type: "object",
        description: "Kidney dialysis, chemo, radiotherapy, etc.",
        properties: {
          limit_by_plan: { type: "object", additionalProperties: { type: "number" } },
          items: { type: "array", items: { type: "string" } },
          pre_existing_waiting_months: { type: "integer", default: 12 },
          co_insurance: { type: "number", default: 0 },
        },
      },
    },
  },

  schemaRate: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      calculation_type: { enum: ["per_group", "per_individual"] },
      proration: { enum: ["daily", "monthly", "annual"] },
      rates: {
        type: "array",
        items: {
          type: "object",
          required: ["plan_id", "coverage_option", "annual_premium"],
          properties: {
            plan_id: { type: "string" },
            coverage_option: { enum: ["EO", "ES", "EC", "EF"] },
            annual_premium: { type: "number", minimum: 0 },
          },
        },
      },
    },
  },

  ingestionTemplate: {
    sheet_matchers: ["GHS", "Group Hospital", "GHS "],
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
    ],
    schedule_section: {
      start_marker: "SCHEDULE OF BENEFITS",
      plan_header_row: { column_offsets_for_plans: [6, 7, 8, 9, 10] },
      line_items: [
        {
          path: "schedule.room_and_board.ward_by_plan",
          row_label_patterns: ["Daily Room & Board", "Daily Room and Board"],
          value_type: "ward_enum",
        },
        {
          path: "schedule.icu.limit_by_plan",
          row_label_patterns: ["Intensive Care Unit", "ICU"],
          value_type: "number",
        },
        {
          path: "schedule.inpatient_expenses.limit_by_plan",
          row_label_patterns: ["In-patient Expenses", "Inpatient Expenses"],
          value_type: "number",
        },
        {
          path: "schedule.outpatient_expenses.limit_by_plan",
          row_label_patterns: ["Out-patient Expenses", "Outpatient Expenses"],
          value_type: "number",
        },
      ],
    },
  },

  displayTemplate: {
    sections: [
      {
        title: "Hospital stay",
        items: [
          {
            label: "Room and board",
            path: "schedule.room_and_board.ward_by_plan.{plan_id}",
            format: "ward",
          },
          {
            label: "Room and board duration",
            path: "schedule.room_and_board.max_days",
            format: "days",
          },
          {
            label: "Intensive care unit",
            path: "schedule.icu.limit_by_plan.{plan_id}",
            format: "currency_sgd",
          },
          {
            label: "Inpatient expenses",
            path: "schedule.inpatient_expenses.limit_by_plan.{plan_id}",
            format: "currency_sgd",
          },
        ],
      },
      {
        title: "Outpatient",
        items: [
          {
            label: "Outpatient expenses",
            path: "schedule.outpatient_expenses.limit_by_plan.{plan_id}",
            format: "currency_sgd",
          },
          {
            label: "Emergency outpatient",
            path: "schedule.emergency_accidental_outpatient.limit_by_plan.{plan_id}",
            format: "currency_sgd",
          },
        ],
      },
    ],
  },
};
