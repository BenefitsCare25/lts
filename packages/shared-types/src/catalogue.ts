// =============================================================
// Catalogue enumerations — single source of truth for the 12
// product type codes and the claim feed protocols. Both the
// server (Zod validators, Prisma seeding) and the UI (admin
// dropdowns) import from here so they cannot drift.
//
// Per v2 plan §3.5 — these are the seed product types. New
// product types arrive via the Product Catalogue editor (S12)
// at runtime, not by editing this file.
// =============================================================

export const PRODUCT_TYPE_CODES = [
  'GTL', // Group Term Life
  'GCI', // Group Critical Illness
  'GDI', // Group Disability Income
  'GPA', // Group Personal Accident
  'GHS', // Group Hospital & Surgical
  'GMM', // Group Major Medical
  'FWM', // Foreign Worker Medical
  'GP', // Group Outpatient (GP)
  'SP', // Specialist Outpatient
  'Dental', // Group Dental
  'GBT', // Group Business Travel
  'WICI', // Work Injury Compensation Insurance
] as const;

export type ProductTypeCode = (typeof PRODUCT_TYPE_CODES)[number];

// Per v2 plan §2.6.1 — formats a TPA delivers claims data in.
// Extend this list as new TPAs are onboarded; values are not tenant-
// scoped because they describe wire formats, not business policy.
export const TPA_FEED_FORMATS = ['CSV_V1', 'CSV_V2', 'JSON_API', 'XLSX'] as const;

export type TpaFeedFormat = (typeof TPA_FEED_FORMATS)[number];

// Per v2 plan §4 — premium calculation strategy codes. Each code
// maps to a TypeScript module under `apps/web/src/server/premium-
// strategies/`. Adding a new strategy is a code change (rare),
// not a catalogue edit.
export const PREMIUM_STRATEGIES = [
  'per_individual_salary_multiple',
  'per_individual_fixed_sum',
  'per_group_cover_tier',
  'per_headcount_flat',
  'per_individual_earnings',
] as const;

export type PremiumStrategy = (typeof PREMIUM_STRATEGIES)[number];

// Shared regex for tenant-unique registry codes (insurer, TPA,
// product type). Same shape on client `pattern=` attributes and
// server-side Zod refinements so the two cannot drift.
export const REGISTRY_CODE_PATTERN = '^[A-Z][A-Z0-9_]*$';
export const REGISTRY_CODE_REGEX = /^[A-Z][A-Z0-9_]*$/;
export const REGISTRY_CODE_HELP =
  'Uppercase letters, digits, underscores. Unique per tenant.';
