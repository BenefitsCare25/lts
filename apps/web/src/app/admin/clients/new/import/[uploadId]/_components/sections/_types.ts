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

// AI-proposed section payloads. Written by the BullMQ extraction
// worker into ExtractionDraft.progress alongside the existing
// `suggestions` blob. Sections 2/3/4/5 read these to seed their form
// state on first load (one-shot, ref-guarded so a poll refetch can't
// re-seed and overwrite a broker who already edited a field).

export type ProposedClient = {
  legalName: string | null;
  tradingName: string | null;
  uen: string | null;
  countryOfIncorporation: string | null;
  address: string | null;
  industry: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type ProposedPolicyEntity = {
  legalName: string;
  policyNumber: string | null;
  address: string | null;
  headcountEstimate: number | null;
  isMaster: boolean;
  confidence: number;
  sourceRef?: SourceRef;
};

export type ProposedBenefitYear = {
  policyName: string | null;
  startDate: string | null;
  endDate: string | null;
  ageBasis: 'POLICY_START' | 'HIRE_DATE' | 'AS_AT_EVENT' | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type ProposedInsurer = {
  code: string;
  rawLabel: string;
  productCount: number;
  confidence: number;
};

export type ProposedPool = {
  name: string | null;
  poolId: string | null;
  rawLabel: string | null;
  confidence: number;
  sourceRef?: SourceRef;
} | null;

export type WizardAiBundle = {
  proposedClient: ProposedClient | null;
  proposedPolicyEntities: ProposedPolicyEntity[];
  proposedBenefitYear: ProposedBenefitYear | null;
  proposedInsurers: ProposedInsurer[];
  proposedPool: ProposedPool;
  warnings: string[];
  // Wizard's status pill copy. Mirrors ExtractionDraft.status but
  // also surfaces the per-stage hint (AI_DISCOVERY / AI_PRODUCTS /
  // CALLING_AI / MERGING / FAILED).
  stage: string | null;
  // Live per-product progress, populated during AI_PRODUCTS stage by
  // the fan-out streaming callback. Null when not in that stage.
  liveProgress: {
    totalProducts: number;
    completedProducts: number;
    lastProductKey: string | null;
    lastProductOk: boolean | null;
  } | null;
  failure: { stage: string; message: string; at?: string } | null;
  ai: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    workbookTruncated: boolean;
    sheetsCount: number;
    productsRequested?: number;
    productsExtracted?: number;
    productsFailed?: number;
    completedAt?: string;
  } | null;
};

export function aiBundleFromDraft(progress: unknown): WizardAiBundle {
  const empty: WizardAiBundle = {
    proposedClient: null,
    proposedPolicyEntities: [],
    proposedBenefitYear: null,
    proposedInsurers: [],
    proposedPool: null,
    warnings: [],
    stage: null,
    liveProgress: null,
    failure: null,
    ai: null,
  };
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return empty;
  const p = progress as {
    proposedClient?: ProposedClient;
    proposedPolicyEntities?: ProposedPolicyEntity[];
    proposedBenefitYear?: ProposedBenefitYear;
    proposedInsurers?: ProposedInsurer[];
    proposedPool?: ProposedPool;
    warnings?: string[];
    stage?: string;
    totalProducts?: number;
    completedProducts?: number;
    lastProductKey?: string;
    lastProductOk?: boolean;
    failure?: { stage: string; message: string; at?: string };
    ai?: WizardAiBundle['ai'];
  };
  // Live per-product progress is only meaningful during AI_PRODUCTS.
  // Once the run completes (status flips to READY/FAILED) the bundle
  // shows the final tallies from `ai.productsExtracted` etc. instead.
  const liveProgress: WizardAiBundle['liveProgress'] =
    p.stage === 'AI_PRODUCTS' && typeof p.totalProducts === 'number'
      ? {
          totalProducts: p.totalProducts,
          completedProducts: p.completedProducts ?? 0,
          lastProductKey: p.lastProductKey ?? null,
          lastProductOk: p.lastProductOk ?? null,
        }
      : null;
  return {
    proposedClient: p.proposedClient ?? null,
    proposedPolicyEntities: p.proposedPolicyEntities ?? [],
    proposedBenefitYear: p.proposedBenefitYear ?? null,
    proposedInsurers: p.proposedInsurers ?? [],
    proposedPool: p.proposedPool ?? null,
    warnings: p.warnings ?? [],
    stage: p.stage ?? null,
    liveProgress,
    failure: p.failure ?? null,
    ai: p.ai ?? null,
  };
}

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
