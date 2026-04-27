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

// Per v2 plan §2.6.1 + §3.4 — claim feed protocols supported by insurers.
// `null` (no feed) is also valid; the UI represents it as "None".
export const CLAIM_FEED_PROTOCOLS = ['IHP', 'TMLS', 'DIRECT_API'] as const;

export type ClaimFeedProtocol = (typeof CLAIM_FEED_PROTOCOLS)[number];

// Per v2 plan §2.6.1 — formats a TPA delivers claims data in.
// Extend this list as new TPAs are onboarded; values are not tenant-
// scoped because they describe wire formats, not business policy.
export const TPA_FEED_FORMATS = ['CSV_V1', 'CSV_V2', 'JSON_API', 'XLSX'] as const;

export type TpaFeedFormat = (typeof TPA_FEED_FORMATS)[number];
