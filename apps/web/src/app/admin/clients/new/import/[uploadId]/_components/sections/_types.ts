// =============================================================
// Local mirror of the extraction types, narrowed for the wizard
// renderer. Keeps the per-section components decoupled from server-
// side imports while staying structurally compatible with
// server/extraction/heuristic-to-envelope.ts and extractor.ts.
// =============================================================

export type SourceRef = { sheet?: string; cell?: string; range?: string };

export type FieldEnvelope<T> = {
  value: T | null;
  raw?: unknown;
  confidence: number;
  sourceRef?: SourceRef;
};

export type WizardPlanField = {
  rawCode: string;
  rawName: string;
  code: string;
  name: string;
  coverBasis: 'per_cover_tier' | 'salary_multiple' | 'fixed_amount' | 'per_region';
  stacksOnRawCode: string | null;
  selectionMode: 'broker_default' | 'employee_flex';
  schedule: Record<string, unknown>;
  confidence: number;
  sourceRef?: SourceRef;
};

export type WizardPremiumRateField = {
  planRawCode: string;
  coverTier: string | null;
  ratePerThousand: number | null;
  fixedAmount: number | null;
  blockLabel?: string | null;
  ageBand: { from: number; to: number } | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type WizardExtractedProduct = {
  productTypeCode: string;
  insurerCode: string;
  header: {
    policyNumber: FieldEnvelope<string>;
    period: FieldEnvelope<{ from: string; to: string }>;
    lastEntryAge: FieldEnvelope<number>;
    administrationType: FieldEnvelope<string>;
    currency: FieldEnvelope<string>;
  };
  policyholder: {
    legalName: FieldEnvelope<string>;
    uen: FieldEnvelope<string>;
    address: FieldEnvelope<string>;
    businessDescription: FieldEnvelope<string>;
    insuredEntities: Array<{
      legalName: string;
      policyNumber: string | null;
      address: string | null;
      isMaster: boolean;
      confidence: number;
    }>;
  };
  eligibility: {
    freeText: FieldEnvelope<string>;
    categories: Array<{
      category: string;
      headcount: number | null;
      sumInsuredFormula: string | null;
      participation: string | null;
      confidence: number;
    }>;
  };
  plans: WizardPlanField[];
  premiumRates: WizardPremiumRateField[];
  benefits: unknown[];
  extractionMeta: {
    overallConfidence: number;
    extractorVersion: string;
    warnings: string[];
  };
};

export type WizardSuggestions = {
  benefitGroups: Array<{
    sourcePlanLabel: string;
    suggestedName: string;
    description: string;
    predicate: Record<string, unknown>;
    tokenMatches: number;
  }>;
  eligibilityMatrix: Array<{
    groupRawLabel: string;
    perProduct: Array<{
      productTypeCode: string;
      defaultPlanRawCode: string | null;
    }>;
  }>;
  missingPredicateFields: Array<{
    fieldPath: string;
    suggestedType: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum';
    suggestedLabel: string;
    referencedBy: string[];
    enumValues?: string[];
  }>;
  reconciliation: {
    perProduct: Array<{
      productTypeCode: string;
      insurerCode: string;
      computed: number | null;
      declared: number | null;
      variancePct: number | null;
    }>;
    grandComputed: number;
    grandDeclared: number | null;
    grandVariancePct: number | null;
  };
};

// Read suggestions off the draft.progress JSON, defending against
// older drafts created before the suggestions blob landed.
export function suggestionsFromDraft(progress: unknown): WizardSuggestions {
  const empty: WizardSuggestions = {
    benefitGroups: [],
    eligibilityMatrix: [],
    missingPredicateFields: [],
    reconciliation: {
      perProduct: [],
      grandComputed: 0,
      grandDeclared: null,
      grandVariancePct: null,
    },
  };
  if (!progress || typeof progress !== 'object') return empty;
  const obj = progress as { suggestions?: WizardSuggestions };
  return obj.suggestions ?? empty;
}

// Centralised cast for ExtractedProduct[] off the draft. Loose today;
// tightens to a Zod safeParse when the LLM stage lands and we want
// to reject malformed payloads.
export function extractedProductsFromDraft(raw: unknown): WizardExtractedProduct[] {
  if (!Array.isArray(raw)) return [];
  return raw as WizardExtractedProduct[];
}
