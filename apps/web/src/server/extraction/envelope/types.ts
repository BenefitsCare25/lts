// Shared types for the heuristic → ExtractedProduct[] envelope pipeline.
// Imported by all sub-modules and re-exported from heuristic-to-envelope.ts.

import type { CoverBasis } from '@/server/catalogue/premium-strategy';
import type { ParsingRules } from '@/server/ingestion/parser';

export type SourceRef = {
  sheet?: string;
  cell?: string;
  range?: string;
};

export type FieldEnvelope<T> = {
  value: T | null;
  raw?: unknown;
  confidence: number;
  sourceRef?: SourceRef;
};

export type StringField = FieldEnvelope<string>;
export type NumberField = FieldEnvelope<number>;
export type PeriodField = FieldEnvelope<{ from: string; to: string }>;

export type PolicyEntityField = {
  legalName: string;
  policyNumber: string | null;
  address: string | null;
  siteCode: string | null;
  headcountEstimate: number | null;
  isMaster: boolean;
  confidence: number;
  sourceRef?: SourceRef;
};

export type CategoryField = {
  category: string;
  headcount: number | null;
  sumInsuredFormula: string | null;
  participation: string | null;
  defaultPlanRawCode: string | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type PlanField = {
  rawCode: string;
  rawName: string;
  code: string;
  name: string;
  coverBasis: CoverBasis;
  /** @deprecated use stacksOnRawCodes (array) */
  stacksOnRawCode: string | null;
  stacksOnRawCodes: string[];
  selectionMode: 'broker_default' | 'employee_flex';
  schedule: Record<string, unknown>;
  confidence: number;
  sourceRef?: SourceRef;
};

export type PremiumRateField = {
  planRawCode: string;
  coverTier: string | null;
  ratePerThousand: number | null;
  fixedAmount: number | null;
  blockLabel?: string | null;
  ageBand: { from: number; to: number } | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type BenefitField = {
  rawName: string;
  name: string;
  description: string | null;
  limits: Array<{
    planRawCode: string;
    amount: number | null;
    unit: string | null;
    rawText: string | null;
  }>;
  deductible: number | null;
  coInsurancePct: number | null;
  waitingPeriodDays: number | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type ExtractedProduct = {
  productTypeCode: string;
  insurerCode: string;
  bundledWithProductCode?: string | null;
  header: {
    policyNumber: StringField;
    period: PeriodField;
    lastEntryAge: NumberField;
    administrationType: StringField;
    currency: StringField;
    declaredPremium?: NumberField;
    nonEvidenceLimit?: StringField;
    ageLimitNoUnderwriting?: NumberField;
    aboveLastEntryAge?: StringField;
    employeeAgeLimit?: NumberField;
    spouseAgeLimit?: NumberField;
    childAgeLimit?: NumberField;
    childMinimumAge?: NumberField;
  };
  policyholder: {
    legalName: StringField;
    uen: StringField;
    address: StringField;
    businessDescription: StringField;
    insuredEntities: PolicyEntityField[];
  };
  eligibility: {
    freeText: StringField;
    categories: CategoryField[];
  };
  plans: PlanField[];
  premiumRates: PremiumRateField[];
  benefits: BenefitField[];
  extractionMeta: {
    overallConfidence: number;
    extractorVersion: string;
    warnings: string[];
  };
};

export type CatalogueLookup = {
  productTypeStrategy: Record<string, string>; // productTypeCode → premiumStrategy
  parsingRules: Record<string, Record<string, ParsingRules>>; // productTypeCode → insurerCode → ParsingRules
};
