// =============================================================
// Local mirror of the extraction types, narrowed for the wizard
// renderer. Keeps the per-section components decoupled from server-
// side imports while staying structurally compatible with
// server/extraction/heuristic-to-envelope.ts and extractor.ts.
// =============================================================

import { z } from 'zod';

export type SourceRef = { sheet?: string; cell?: string; range?: string };

// Loose schema — validates the minimum required to render any product
// card without crashing. Extra fields are preserved via passthrough so
// the wizard never silently drops data when the envelope schema evolves.
const wizardExtractedProductSchema = z
  .object({
    productTypeCode: z.string().min(1),
    insurerCode: z.string().min(1),
  })
  .passthrough();

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
  coverBasis:
    | 'per_cover_tier'
    | 'salary_multiple'
    | 'fixed_amount'
    | 'per_region'
    | 'earnings_based'
    | 'per_employee_flat';
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
    ageLimitNoUnderwriting: FieldEnvelope<number>;
    aboveLastEntryAge: FieldEnvelope<string>;
    employeeAgeLimit: FieldEnvelope<number>;
    spouseAgeLimit: FieldEnvelope<number>;
    childAgeLimit: FieldEnvelope<number>;
    childMinimumAge: FieldEnvelope<number>;
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
      defaultPlanRawCode: string | null;
      confidence: number;
    }>;
  };
  tpaId: string | null;
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

export type ProposedTpa = {
  name: string | null;
  tpaId: string | null;
  rawLabel: string | null;
  confidence: number;
  sourceRef?: SourceRef;
} | null;

export type LiveStage = 'AI_DISCOVERY' | 'AI_PRODUCTS';
export type LiveProductStatus = 'queued' | 'running' | 'ok' | 'failed';

export type WizardAiBundle = {
  proposedClient: ProposedClient | null;
  proposedPolicyEntities: ProposedPolicyEntity[];
  proposedBenefitYear: ProposedBenefitYear | null;
  proposedInsurers: ProposedInsurer[];
  proposedPool: ProposedPool;
  proposedTpa: ProposedTpa;
  warnings: string[];
  // Wizard's status pill copy. Mirrors ExtractionDraft.status but
  // also surfaces the per-stage hint (AI_DISCOVERY / AI_PRODUCTS /
  // CALLING_AI / MERGING / FAILED).
  stage: string | null;
  // Rich live extraction progress, populated by the runner's
  // streaming callback. Null when no run is active. Drives the
  // ExtractionProgress card.
  live: {
    stage: LiveStage;
    startedAt: string | null; // ISO timestamp; client computes elapsed
    productKeys: string[]; // full manifest order, set on discovery_done
    statuses: Record<string, LiveProductStatus>;
    completedCount: number;
    lastCompleted: { key: string; ok: boolean } | null;
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
    proposedTpa: null,
    warnings: [],
    stage: null,
    live: null,
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
    proposedTpa?: ProposedTpa;
    warnings?: string[];
    stage?: string;
    live?: {
      stage?: LiveStage;
      startedAt?: string;
      productKeys?: string[];
      statuses?: Record<string, LiveProductStatus>;
      completedCount?: number;
      lastCompleted?: { key: string; ok: boolean };
    };
    failure?: { stage: string; message: string; at?: string };
    ai?: WizardAiBundle['ai'];
  };
  const live: WizardAiBundle['live'] = p.live
    ? {
        stage: p.live.stage ?? 'AI_DISCOVERY',
        startedAt: p.live.startedAt ?? null,
        productKeys: p.live.productKeys ?? [],
        statuses: p.live.statuses ?? {},
        completedCount: p.live.completedCount ?? 0,
        lastCompleted: p.live.lastCompleted ?? null,
      }
    : null;
  return {
    proposedClient: p.proposedClient ?? null,
    proposedPolicyEntities: p.proposedPolicyEntities ?? [],
    proposedBenefitYear: p.proposedBenefitYear ?? null,
    proposedInsurers: p.proposedInsurers ?? [],
    proposedPool: p.proposedPool ?? null,
    proposedTpa: p.proposedTpa ?? null,
    warnings: p.warnings ?? [],
    stage: p.stage ?? null,
    live,
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

const EMPTY_NUMBER_FIELD: FieldEnvelope<number> = { value: null, confidence: 0 };
const EMPTY_STRING_FIELD: FieldEnvelope<string> = { value: null, confidence: 0 };

// Ensure all header fields introduced after v1 are present, so
// downstream components can access them without optional-chaining.
function normalizeProduct(raw: unknown): WizardExtractedProduct {
  const p = raw as WizardExtractedProduct;
  const h = (p.header ?? {}) as WizardExtractedProduct['header'] & Record<string, unknown>;
  return {
    ...p,
    tpaId: (p as Record<string, unknown>).tpaId as string | null | undefined ?? null,
    header: {
      ...h,
      ageLimitNoUnderwriting:
        (h.ageLimitNoUnderwriting as FieldEnvelope<number> | undefined) ?? EMPTY_NUMBER_FIELD,
      aboveLastEntryAge:
        (h.aboveLastEntryAge as FieldEnvelope<string> | undefined) ?? EMPTY_STRING_FIELD,
      employeeAgeLimit:
        (h.employeeAgeLimit as FieldEnvelope<number> | undefined) ?? EMPTY_NUMBER_FIELD,
      spouseAgeLimit: (h.spouseAgeLimit as FieldEnvelope<number> | undefined) ?? EMPTY_NUMBER_FIELD,
      childAgeLimit: (h.childAgeLimit as FieldEnvelope<number> | undefined) ?? EMPTY_NUMBER_FIELD,
      childMinimumAge:
        (h.childMinimumAge as FieldEnvelope<number> | undefined) ?? EMPTY_NUMBER_FIELD,
    },
  };
}

// Centralised read for ExtractedProduct[] off the draft. Uses Zod
// safeParse to drop structurally invalid items without crashing the
// wizard — a malformed product is logged and skipped rather than
// propagating as an exception to the page boundary.
export function extractedProductsFromDraft(raw: unknown): WizardExtractedProduct[] {
  if (!Array.isArray(raw)) return [];
  const result: WizardExtractedProduct[] = [];
  for (const item of raw) {
    const parsed = wizardExtractedProductSchema.safeParse(item);
    if (parsed.success) {
      result.push(normalizeProduct(parsed.data));
    }
  }
  return result;
}

export const BROKER_OVERRIDE_NAMESPACES = [
  'insurers',
  'pool',
  'eligibility',
  'schemaDecisions',
  'reconciliation',
] as const;

export type BrokerOverrideNamespace = (typeof BROKER_OVERRIDE_NAMESPACES)[number];

// Read a namespaced override off draft.progress.brokerOverrides,
// returning fallback when the path is missing or the value isn't a
// plain object. Sections layer their own structural narrowing on top.
export function readBrokerOverride<T>(
  progress: unknown,
  namespace: BrokerOverrideNamespace,
  fallback: T,
): T {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return fallback;
  const overrides = (progress as { brokerOverrides?: unknown }).brokerOverrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return fallback;
  const value = (overrides as Record<string, unknown>)[namespace];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value as T;
}
