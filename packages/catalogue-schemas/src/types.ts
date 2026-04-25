/**
 * Shared types for catalogue seed entries.
 *
 * The runtime row shape lives in `prisma/schema.prisma` (`ProductType` /
 * `ProductTypeVersion`); this file describes the seed-time payload before
 * it is written to the DB.
 */

export type ProductCategory = "life" | "health" | "statutory" | "other";

// JSON Schema is structurally open — we keep this loose at the type level
// and rely on Ajv to validate at runtime (post-S9).
export type JsonSchema = Record<string, unknown>;

export interface IngestionTemplate {
  sheet_matchers: string[];
  header_fields?: Array<{
    path: string;
    row_label: string;
    column_offset: number;
    extract?: "first_integer" | "first_number" | "string";
  }>;
  schedule_section?: {
    start_marker: string;
    plan_header_row?: { column_offsets_for_plans: number[] };
    line_items: Array<{
      path: string;
      row_label_patterns: string[];
      value_type: "ward_enum" | "number" | "boolean" | "string";
    }>;
  };
}

export interface DisplayTemplate {
  sections: Array<{
    title: string;
    items: Array<{
      label: string;
      path: string;
      format?: "currency_sgd" | "days" | "ward" | "boolean_yes_no" | "nat_lang";
    }>;
  }>;
}

export interface ProductTypeSeed {
  code: string;
  name: string;
  category: ProductCategory;
  description?: string;
  version: number;
  effectiveFrom: string; // ISO date
  calcStrategy: string;
  schemaProduct: JsonSchema;
  schemaPlan: JsonSchema;
  schemaSchedule: JsonSchema;
  schemaRate: JsonSchema;
  ingestionTemplate: IngestionTemplate;
  displayTemplate: DisplayTemplate;
}
