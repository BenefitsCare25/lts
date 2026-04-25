# Dynamic Product Architecture — Technical Design

How to build the insurance SaaS so that every insurer product fits in the same system without custom code per product. This is the deep-dive companion to the platform plan.

---

## 1. Recommendation

Build a **metadata-driven product catalogue** where each product type (GTL, GHS, GPA, GMM, GCI, GDI, SP, GP, Dental, FWM, GBT, WICI, and anything future) is defined as **data** — a JSON Schema stored in a `product_types` table. Product instances store their specifics as JSONB columns validated against that schema. Admin forms, Excel parsers, employee displays, and insurer census files are all auto-generated from the same catalogue entry. Adding a new product or evolving an existing one is a config change, not a deploy.

This single decision — catalogue as data, not code — is what makes the platform actually dynamic. Every other "dynamic" feature you want falls out of this choice naturally.

## 2. Why alternatives fail

A **table-per-product** approach (`gtl_policies`, `ghs_policies`, `gpa_policies`) works for 2–3 products and collapses after that. Every new insurer product triggers a migration, a deploy, a new form component, a new parser module, a new display template. The STM placement slip alone has seven products across five insurers — by year two you'd have thirty-plus such tables and a codebase where 80% of the lines are product-specific boilerplate. You cannot out-engineer this; the only fix is to not do it.

An **EAV (entity-attribute-value)** approach — one `field_values` table with rows like `(policy_id, 'daily_room_board', '1 Bed Private')` — gives you flexibility but throws away type safety, validation, and query performance. You'll end up reinventing a schema system on top of it anyway, badly.

**Pure JSONB with no schema** gets you flexibility but no validation — which is fine for logs, fatal for insurance data. A broker typos "15000" as "150000" and a 1 Bed Private patient walks into a $150,000 cap they don't actually have. You need validation; the question is whether the schema lives in code (migration pain) or in data (no pain).

**JSON Schema + JSONB** is the answer. JSON Schema is a mature, standardised spec (it powers OpenAPI, GitHub Actions configs, VS Code settings, npm package.json validation). Libraries exist in every language. Editors and form generators consume it natively. It's as strict as columns when you need it to be, and as flexible as free-form JSON when you don't.

## 3. The three-layer model

**Layer 1 — Relational core.** Tables that exist regardless of what products are sold. Tenants, Clients, PolicyHoldingEntities, Policies, PolicyVersions, Insurers, BenefitGroups, Employees, Dependents, Enrollments. These have fixed columns and evolve through normal migrations — but they evolve rarely because they describe the *structure of insurance as an industry*, not the details of any product.

**Layer 2 — Product catalogue.** A `product_types` table where each row is a full definition of one product type — its schemas, its parsing template, its display template, its calculation strategy reference, its version. Editable through a catalogue admin UI. Versioned.

**Layer 3 — Product instances.** Rows in `products`, `plans`, `premium_rates`, `benefit_schedules` tables, each with a `product_type_code` foreign key to the catalogue and a JSONB column holding the type-specific data. The application validates JSONB against the catalogue schema on every write.

Below the instance layer, all surfaces (admin form, employee portal, Excel parser, census file generator) read from catalogue + instance together. The catalogue tells them *what shape to expect*; the instance provides *the actual values*.

## 4. ProductTypeDefinition — the anatomy of a catalogue entry

Every row in `product_types` has these fields:

```
code              : 'GHS' / 'GTL' / 'GPA' / 'DENTAL' / ...
name              : 'Group Hospital and Surgical'
category          : 'health' | 'life' | 'statutory' | 'other'
version           : integer, incremented on schema change
effective_from    : date the version becomes valid
schema_product    : JSON Schema for product-level fields
schema_plan       : JSON Schema for plan-level fields
schema_schedule   : JSON Schema for the schedule of benefits
schema_rate       : JSON Schema for premium rate structures
ingestion_template: structured rules for parsing Excel placement slips
display_template  : rendering template for the employee portal
calc_strategy     : reference to a premium calculation strategy
status            : 'draft' | 'active' | 'retired'
```

Five schemas per product, because different parts of the data have different shapes. The product-level schema captures things like the insurer, policy number, eligibility rules, last entry age. The plan-level schema captures plan names and identifiers (Plan 1 "1 Bed Private", Plan 4 "4 Bed Restructured"). The schedule captures the benefit line items (Room & Board, ICU, Inpatient, Outpatient, etc.). The rate schema captures the premium rate structure (per-individual rate per $1,000 for GTL, per-coverage-option fixed premium for GHS). The ingestion template captures how to extract these from the broker's Excel workbook; the display template captures how to present them to employees.

## 5. Concrete: GHS product type (based on CUBER AI's placement slip)

Here is a trimmed but realistic GHS catalogue entry. The schedule portion shows about 40% of the real benefit lines — the full one extends with miscarriage, funeral, ambulance, overseas accident, community rehab, home nursing, inpatient psychiatric, and GST extension in the same pattern.

### schema_product

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["insurer", "policy_number", "eligibility", "last_entry_age", "administration_basis"],
  "properties": {
    "insurer":            { "type": "string" },
    "policy_number":      { "type": "string" },
    "pool":               { "type": "string", "nullable": true },
    "eligibility":        { "type": "string", "description": "Natural-language eligibility clause" },
    "age_limit_no_uw":    { "type": "integer", "minimum": 0, "description": "Age limit for no underwriting" },
    "last_entry_age":     { "type": "integer", "minimum": 0 },
    "employee_age_limit": { "type": "integer", "minimum": 0 },
    "administration_basis": { "enum": ["name", "headcount"] },
    "premium_currency":   { "type": "string", "default": "SGD" },
    "gst_extension":      { "type": "boolean", "default": true },
    "tpa":                { "type": "string", "nullable": true, "description": "E.g. IHP, TMLS" },
    "claim_data_feed":    { "type": "string", "nullable": true, "description": "E.g. SG TM (IHP)" }
  }
}
```

### schema_plan

```json
{
  "type": "object",
  "required": ["plan_id", "name", "ward_class"],
  "properties": {
    "plan_id":    { "type": "string", "pattern": "^[A-Za-z0-9_-]+$" },
    "name":       { "type": "string" },
    "ward_class": { "enum": ["1_bed_private", "2_bed_private", "4_bed_restructured", "b1", "b2", "c"] }
  }
}
```

### schema_schedule (the schedule of benefits — values keyed by plan_id)

```json
{
  "type": "object",
  "required": ["room_and_board", "icu", "inpatient_expenses", "outpatient_expenses"],
  "properties": {
    "per_disability_qualification_days": {
      "type": "integer",
      "description": "Days after discharge before new disability resets"
    },
    "room_and_board": {
      "type": "object",
      "required": ["ward_by_plan", "max_days"],
      "properties": {
        "ward_by_plan": {
          "type": "object",
          "additionalProperties": { "enum": ["1_bed_private", "2_bed_private", "4_bed_restructured", "b1", "b2", "c"] }
        },
        "max_days": { "type": "integer", "default": 120 }
      }
    },
    "icu": {
      "type": "object",
      "properties": {
        "limit_by_plan": { "type": "object", "additionalProperties": { "type": "number" } },
        "max_days":      { "type": "integer", "default": 30 }
      }
    },
    "inpatient_expenses": {
      "type": "object",
      "properties": {
        "limit_by_plan":          { "type": "object", "additionalProperties": { "type": "number" } },
        "includes_surgical_implants": { "type": "boolean" },
        "surgical_schedule_threshold": { "type": "number" }
      }
    },
    "outpatient_expenses": {
      "type": "object",
      "properties": {
        "limit_by_plan":                    { "type": "object", "additionalProperties": { "type": "number" } },
        "pre_hospitalisation_days":         { "type": "integer" },
        "post_hospitalisation_days":        { "type": "integer" }
      }
    },
    "emergency_accidental_outpatient": {
      "type": "object",
      "properties": {
        "limit_by_plan":     { "type": "object", "additionalProperties": { "type": "number" } },
        "treatment_window_hours":  { "type": "integer", "default": 24 },
        "followup_days":     { "type": "integer", "default": 31 }
      }
    },
    "outpatient_treatments": {
      "type": "object",
      "description": "Kidney dialysis, chemo, radiotherapy, etc.",
      "properties": {
        "limit_by_plan": { "type": "object", "additionalProperties": { "type": "number" } },
        "items":         { "type": "array", "items": { "type": "string" } },
        "pre_existing_waiting_months": { "type": "integer", "default": 12 },
        "co_insurance":  { "type": "number", "default": 0 }
      }
    }
  }
}
```

### schema_rate (per-group, per-coverage-option)

```json
{
  "type": "object",
  "properties": {
    "calculation_type": { "enum": ["per_group", "per_individual"] },
    "proration":        { "enum": ["daily", "monthly", "annual"] },
    "rates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["plan_id", "coverage_option", "annual_premium"],
        "properties": {
          "plan_id":         { "type": "string" },
          "coverage_option": { "enum": ["EO", "ES", "EC", "EF"] },
          "annual_premium":  { "type": "number", "minimum": 0 }
        }
      }
    }
  }
}
```

## 6. Concrete: GTL product type

GTL has a fundamentally different shape — no schedule of benefits in the GHS sense, but a sum assured with two possible bases.

### schema_product — only the part that differs from GHS

```json
{
  "type": "object",
  "properties": {
    "sum_assured_currency":  { "type": "string", "default": "SGD" },
    "no_evidence_limit":     { "type": "number", "description": "Above this, underwriting required" },
    "maximum_limit_per_life":{ "type": "number" }
  }
}
```

### schema_plan — GTL plans are cover levels, not ward tiers

```json
{
  "type": "object",
  "required": ["plan_id", "name", "basis_type"],
  "oneOf": [
    {
      "properties": {
        "basis_type":   { "const": "fixed" },
        "sum_assured": { "type": "number", "minimum": 0 }
      },
      "required": ["basis_type", "sum_assured"]
    },
    {
      "properties": {
        "basis_type":      { "const": "salary_multiple" },
        "multiplier":      { "type": "number", "minimum": 0 },
        "salary_basis":    { "enum": ["last_drawn_monthly", "annual"] },
        "min_sum_assured": { "type": "number" },
        "max_sum_assured": { "type": "number" }
      },
      "required": ["basis_type", "multiplier", "salary_basis"]
    }
  ]
}
```

### schema_schedule — GTL benefit structure

```json
{
  "type": "object",
  "properties": {
    "death_benefit":              { "type": "boolean", "default": true },
    "tpd_benefit":                { "type": "boolean", "default": true },
    "tpd_max_age":                { "type": "integer", "default": 70 },
    "family_income_benefit": {
      "type": "object",
      "properties": {
        "monthly_percent_of_sum_assured": { "type": "number" },
        "months":                         { "type": "integer", "default": 12 }
      }
    },
    "terminal_illness_benefit": { "type": "boolean", "default": true },
    "extended_benefit": {
      "type": "object",
      "properties": {
        "months":                  { "type": "integer" },
        "termination_window_months": { "type": "integer" }
      }
    },
    "repatriation_benefit": {
      "type": "object",
      "properties": {
        "max_amount": { "type": "number" }
      }
    }
  }
}
```

### schema_rate — per-individual, rate per $1,000 sum assured

```json
{
  "type": "object",
  "properties": {
    "calculation_type":        { "const": "per_individual" },
    "distinct_benefit_group_pricing": { "type": "boolean" },
    "rates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["benefit_group_id", "rate_per_1000"],
        "properties": {
          "benefit_group_id": { "type": "string" },
          "rate_per_1000":    { "type": "number", "minimum": 0 }
        }
      }
    }
  }
}
```

## 7. Concrete: Dental (the simple one)

Dental shows that simple products stay simple — the JSON Schema mirrors the natural shape.

```json
{
  "schema_schedule": {
    "type": "object",
    "properties": {
      "annual_limit":    { "type": "number" },
      "coverage_region": { "enum": ["singapore", "singapore_malaysia", "worldwide"] },
      "specialist_dentist_extension": { "type": "boolean" },
      "medication_extension":         { "type": "boolean" },
      "gst_extension":                { "type": "boolean" },
      "covered_procedures": {
        "type": "array",
        "items": {
          "enum": [
            "consultation", "oral_examination", "medication", "gum_treatment",
            "x_rays", "prophylaxis", "amalgam_fillings", "composite_fillings",
            "tooth_coloured_restorations", "extractions", "sedative_dressings",
            "retention_pins", "oral_surgery", "root_canal", "periodontal",
            "crowning_accidental", "bridges_accidental", "tooth_replantation"
          ]
        }
      }
    }
  }
}
```

A client with dental essentially just picks their covered procedures from the enum and sets an annual limit. New procedure added by a new insurer? Extend the enum in a new schema version. Existing data still validates.

## 8. Instance example: CUBER AI's published GHS for 2025-26

This is what ends up in the database after the CUBER placement slip is ingested and published. `policy_id` points at the relational core; `type_code` references the catalogue; `data` is the validated JSONB.

```json
{
  "policy_id":     "uuid-cuber-ghs-2025",
  "type_code":     "GHS",
  "type_version":  3,
  "benefit_year":  "2025-05-01..2026-04-30",
  "status":        "published",
  "data": {
    "insurer":             "Tokio Marine Life Insurance Singapore",
    "policy_number":       "S0011653",
    "eligibility":         "All full time & permanent employees up to 74 (age next birthday)",
    "age_limit_no_uw":     999,
    "last_entry_age":      73,
    "employee_age_limit":  73,
    "administration_basis":"name",
    "premium_currency":    "SGD",
    "gst_extension":       true,
    "tpa":                 "IHP",
    "claim_data_feed":     "SG TM (IHP)"
  },
  "plans": [
    {
      "plan_id":    "plan_1",
      "name":       "1 Bedded Private",
      "ward_class": "1_bed_private"
    },
    {
      "plan_id":    "plan_4",
      "name":       "4 Bedded Restructured",
      "ward_class": "4_bed_restructured"
    }
  ],
  "schedule": {
    "per_disability_qualification_days": 14,
    "room_and_board": {
      "ward_by_plan": { "plan_1": "1_bed_private", "plan_4": "4_bed_restructured" },
      "max_days": 120
    },
    "icu": {
      "limit_by_plan": { "plan_1": 15000, "plan_4": 15000 },
      "max_days": 30
    },
    "inpatient_expenses": {
      "limit_by_plan": { "plan_1": 25000, "plan_4": 15000 },
      "includes_surgical_implants": true,
      "surgical_schedule_threshold": 1500
    },
    "outpatient_expenses": {
      "limit_by_plan": { "plan_1": 3000, "plan_4": 1500 },
      "pre_hospitalisation_days": 120,
      "post_hospitalisation_days": 120
    },
    "emergency_accidental_outpatient": {
      "limit_by_plan": { "plan_1": 3000, "plan_4": 1500 },
      "treatment_window_hours": 24,
      "followup_days": 31
    },
    "outpatient_treatments": {
      "limit_by_plan": { "plan_1": 25000, "plan_4": 15000 },
      "items": ["kidney_dialysis", "erythropoietin", "cyclosporin", "chemotherapy", "immunotherapy", "radiotherapy"],
      "pre_existing_waiting_months": 12,
      "co_insurance": 0
    }
  },
  "rates": {
    "calculation_type": "per_group",
    "proration": "daily",
    "rates": [
      { "plan_id": "plan_1", "coverage_option": "EO", "annual_premium": 360 },
      { "plan_id": "plan_1", "coverage_option": "ES", "annual_premium": 900 },
      { "plan_id": "plan_1", "coverage_option": "EC", "annual_premium": 900 },
      { "plan_id": "plan_1", "coverage_option": "EF", "annual_premium": 1260 },
      { "plan_id": "plan_4", "coverage_option": "EO", "annual_premium": 172 },
      { "plan_id": "plan_4", "coverage_option": "ES", "annual_premium": 430 },
      { "plan_id": "plan_4", "coverage_option": "EC", "annual_premium": 430 },
      { "plan_id": "plan_4", "coverage_option": "EF", "annual_premium": 602 }
    ]
  }
}
```

Every value above is pulled directly from the CUBER AI placement slip. Every field is declared in the GHS catalogue schemas. Storing this costs one row plus some JSONB.

## 9. Benefit groups with compound eligibility

The STM placement slip has benefit groups like "Hay Job Grade 18 and above (SG/PR) and their Eligible Dependents" and "Foreign Workers holding Work Permit or S-Pass with Hay Job Grade 08 to 10". These are compound predicates over employee attributes. Hardcoding them would defeat the whole dynamic-catalogue premise.

Store each benefit group with a predicate tree. **JSONLogic** is a tiny JSON DSL that expresses boolean rules as data and evaluates in every language. Example:

```json
{
  "benefit_group": {
    "id": "stm_hjg18_plus_sgpr",
    "name": "Hay Job Grade 18 and above (SG/PR)",
    "predicate": {
      "and": [
        { "in": [ { "var": "employee.nationality" }, ["SG", "PR"] ] },
        { ">=": [ { "var": "employee.hay_job_grade" }, 18 ] },
        { "==": [ { "var": "employee.employment_type" }, "permanent" ] }
      ]
    }
  }
}
```

Another STM group, for foreign workers:

```json
{
  "benefit_group": {
    "id": "stm_fw_hjg08_10",
    "name": "Foreign Workers (Work Permit / S-Pass) with HJG 08-10",
    "predicate": {
      "and": [
        { "in": [ { "var": "employee.work_pass_type" }, ["work_permit", "s_pass"] ] },
        { ">=": [ { "var": "employee.hay_job_grade" }, 8 ] },
        { "<=": [ { "var": "employee.hay_job_grade" }, 10 ] }
      ]
    }
  }
}
```

At enrollment time — or whenever an employee's attributes change — the eligibility engine evaluates every benefit group's predicate against the employee and picks the most specific match. For the admin UI, a predicate builder lets the broker assemble these rules without writing JSON by hand.

JSONLogic has implementations in JavaScript, Python, PHP, Ruby, Go, and Java, so the rules work identically on the backend, in the admin UI preview, and in any downstream tool. The whole library is under 200 lines in most languages — it's trivial to audit.

For edge cases that predicates can't express (the "Bargainable Staff who are Fire Fighters" rider in STM), use a small list of named extensions on top of the base benefit group, each with its own predicate.

## 10. Premium calculation strategies

The placement slips reveal roughly five premium calculation patterns. Rather than embed formulas in product type definitions directly, reference a named strategy from a small strategy catalogue. The strategies are code (they're math), but there are few of them and new ones are rare.

| Strategy code | What it does | Used by |
|---|---|---|
| `per_individual_salary_multiple` | For each employee, compute sum_assured = salary × multiplier (bounded by min/max), then premium = sum_assured / 1000 × rate_per_1000. Sum across employees. | GTL (STM, CUBER corporate staff), GDI |
| `per_individual_fixed_sum` | For each employee, premium = sum_assured / 1000 × rate_per_1000. | GTL (CUBER senior management, fixed Plan 5), GCI |
| `per_group_coverage_lookup` | For each employee, look up (plan, coverage_option) in rates table to get annual_premium. Apply daily proration for mid-year events. | GHS, GMM, SP, GP, Dental |
| `per_headcount` | Count employees in scope × rate per head. | WICA, some FWM |
| `per_individual_age_banded` | Rate varies by age band. For each employee, find band, apply rate. | Some GPA variants |

Each strategy takes the product instance + the enrollment ledger + a billing date and returns premium numbers. The product type definition's `calc_strategy` field references one by code. Bugs get fixed in one place, and the catalogue stays data-only.

## 11. Driving admin forms from schema

React and Vue both have mature JSON-Schema-driven form libraries. `@rjsf/core` (react-jsonschema-form) is the reference implementation — point it at a schema and it renders a complete form with validation, error handling, and typed outputs. Custom widgets handle the cases that don't map cleanly to generic inputs — the EO/ES/EC/EF rate grid, the per-plan schedule editor, the predicate builder for benefit groups.

The broker's experience becomes: pick the product type, the form appears, fill it in (or review parsed values from an uploaded placement slip), save. No developer involvement for any product that's already in the catalogue. Adding a new insurer product = a catalogue admin (a senior broker, not an engineer) writes the schema once and the form appears.

For UI ergonomics, attach a `ui:schema` sibling to each JSON Schema that controls presentation (field order, widget choice, help text, conditional display). This is also data. The broker can tune presentation without touching code.

## 12. Driving the employee display

The employee portal needs to turn `{"outpatient_expenses": {"limit_by_plan": {"plan_1": 3000}}}` into *"Your outpatient expenses are covered up to S$3,000 per disability"*. Two parts: a per-product display template + a small formatting library.

The display template is a tree of named sections, each containing a labelled value or sub-tree reference. The template references schema paths, not hardcoded field names:

```json
{
  "sections": [
    {
      "title": "Hospital stay",
      "items": [
        { "label": "Room and board",         "path": "schedule.room_and_board.ward_by_plan.{plan_id}", "format": "ward" },
        { "label": "Room and board duration","path": "schedule.room_and_board.max_days",              "format": "days" },
        { "label": "Intensive care unit",    "path": "schedule.icu.limit_by_plan.{plan_id}",          "format": "currency_sgd" },
        { "label": "Inpatient expenses",     "path": "schedule.inpatient_expenses.limit_by_plan.{plan_id}", "format": "currency_sgd" }
      ]
    },
    {
      "title": "Outpatient",
      "items": [
        { "label": "Outpatient expenses",           "path": "schedule.outpatient_expenses.limit_by_plan.{plan_id}",         "format": "currency_sgd" },
        { "label": "Emergency outpatient",          "path": "schedule.emergency_accidental_outpatient.limit_by_plan.{plan_id}", "format": "currency_sgd" }
      ]
    }
  ]
}
```

The template is stored in the catalogue alongside the schema. Formatters (`currency_sgd`, `days`, `ward`, `boolean_yes_no`, `nat_lang`) are a small library of reusable functions. Adding a new presentation pattern = add a formatter.

The employee sees a clean list. Behind it, the renderer walks the template, resolves each `path` against the instance data (substituting `{plan_id}` with the employee's assigned plan), and applies the formatter. No per-product UI code.

## 13. Driving the Excel parser

The ingestion template is the inverse of the display template — it tells the parser how to find each field in the placement slip's Excel layout.

```json
{
  "sheet_matchers": ["GHS", "Group Hospital", "GHS "],
  "header_fields": [
    { "path": "insurer",        "row_label": "Insurer :",       "column_offset": 1 },
    { "path": "policy_number",  "row_label": "Policy No. :",    "column_offset": 1 },
    { "path": "eligibility",    "row_label": "Eligibility :",   "column_offset": 1 },
    { "path": "last_entry_age", "row_label": "Last entry age :", "column_offset": 1, "extract": "first_integer" }
  ],
  "schedule_section": {
    "start_marker": "SCHEDULE OF BENEFITS",
    "plan_header_row": { "column_offsets_for_plans": [6, 7, 8, 9, 10] },
    "line_items": [
      {
        "path": "schedule.room_and_board.ward_by_plan",
        "row_label_patterns": ["Daily Room & Board", "Daily Room and Board"],
        "value_type": "ward_enum"
      },
      {
        "path": "schedule.icu.limit_by_plan",
        "row_label_patterns": ["Intensive Care Unit", "ICU"],
        "value_type": "number"
      },
      {
        "path": "schedule.inpatient_expenses.limit_by_plan",
        "row_label_patterns": ["In-patient Expenses", "Inpatient Expenses"],
        "value_type": "number"
      }
    ]
  }
}
```

The parser walks each sheet, identifies the product type by matching sheet names against `sheet_matchers`, then extracts fields. Unknown rows get flagged for manual review — they never silently drop. Confidence scores attach to each extracted field so the review UI can highlight low-confidence values.

When a new insurer uses slightly different row labels ("Room & Board Charges" instead of "Daily Room & Board"), add the pattern to the catalogue — no parser code change.

## 14. Schema versioning

Schemas evolve. A new benefit line appears in an insurer's GHS next renewal. A regulator introduces a new minimum. You can't break every previously-published policy version.

Rule: **never mutate an active schema in place.** Always publish a new version. The `product_types` table stores all versions; each product instance records which version it was written against. Reads through the catalogue pick the matching version automatically. Writes use the latest.

When a schema change is additive (new optional field), you're done — old data still validates. When it's a breaking change (field renamed, field made required), provide a migration function (`v3_to_v4(data)`) that lazily upgrades old instances when they're next edited. Until migrated, they continue to validate against their original version.

For regulatory deadlines that force an immediate upgrade, run the migration in bulk with a background job and record the completion.

## 15. Adding a new product — the end-to-end walkthrough

Hypothetical: a new insurer launches "Group Mental Wellness Cover" with counselling sessions, psychiatric medication reimbursement, and an app subscription.

Step one, write the four schemas. `schema_product` — insurer, policy number, eligibility, last entry age, app provider. `schema_plan` — plan IDs and names. `schema_schedule` — counselling_sessions_per_year, psychiatric_medication_annual_limit, app_subscription_included, emergency_helpline_included. `schema_rate` — likely `per_individual_fixed_sum`.

Step two, design the ingestion template — what sheet name to match, what row labels to look for.

Step three, design the display template — how should this appear in the employee portal. Probably one section with a handful of items.

Step four, pick a premium calculation strategy. For this product, `per_individual_fixed_sum` probably works.

Step five, save the catalogue entry. Run a test ingest against a sample placement slip. Ship.

Elapsed time: hours, not weeks. No developer involvement unless a genuinely new calculation strategy or formatter is needed.

## 16. When this approach strains

**Heavy analytics across many policies.** If you need to answer "what's the average inpatient cap across all GHS policies we manage" you're querying inside JSONB. Postgres indexes JSONB well (GIN indexes, expression indexes on common paths), but complex analytics benefits from flattening into a reporting schema. Set up materialised views or a separate analytical projection (dbt-style) when analytics becomes a real workload. This is a second-system concern, not a day-one concern.

**Cross-product rules.** "If the employee is enrolled in GHS plan 1, they qualify for enhanced GTL coverage." Predicates that reference multiple products need a rule engine that can traverse the full enrollment graph. Start with ad-hoc code for the handful of cross-product rules that actually exist, and graduate to a rule engine only if the count climbs into double digits.

**Deeply non-standard products.** An insurer launches something genuinely weird (a parametric insurance product priced on observed weather data, say). At some point a new product may not fit the catalogue model at all. When that happens, accept that the catalogue is a 95% tool and handle that product as a custom module. Don't torture the catalogue to cover 100%.

**Schema sprawl.** Over time, accumulating schemas gets unwieldy. Mitigations: strict review process for new catalogue entries, shared sub-schemas (`$ref`) for common patterns like the EO/ES/EC/EF coverage option, periodic deprecation of retired product types.

## 17. Recommended stack

PostgreSQL 15+ for primary storage — JSONB, GIN indexes, row-level security, full ACID transactions for the enrollment ledger.

Ajv (Node) or `jsonschema` (Python) for schema validation on the server. Run validation on every write that touches a JSONB instance field. Cache compiled validators in memory keyed by schema version.

`@rjsf/core` (react-jsonschema-form) or `vuetify-jsonschema-form` for admin form generation. Custom widgets for the 5–10 patterns that need domain-specific UI.

JSONLogic for benefit group predicates. Libraries in every language that matters.

A background job system for ingestion, publishing, and migrations — BullMQ if you're Node-heavy, Temporal if you want durable workflows (publish/unpublish is naturally a workflow), Celery if you're Python.

Redis for caching compiled schemas, compiled predicates, and per-request catalogue lookups. The catalogue changes slowly — cache aggressively.

S3-compatible object storage for original placement slip uploads, supporting documents, and generated census files. Versioned buckets for compliance.

Next.js or Remix for the frontend, tRPC or GraphQL for the API layer if you want typed contracts end-to-end.

---

## One principle to remember

Every time you're tempted to hardcode something product-specific — a form field, a display line, a parser rule — stop and ask whether it belongs in the catalogue instead. If you find yourself writing `if (product_type === 'GHS')` in application code, you've probably missed a place where the catalogue should have been extended. The application code should know about *insurance in general* (policies have periods, employees have dependents, premiums get billed) and delegate everything *product-specific* to the catalogue.

Held to that line, the platform stays small and flexible as the insurer ecosystem changes around it.
