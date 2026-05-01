// =============================================================
// Extractor — orchestrator the wizard depends on.
//
// Inputs: raw workbook bytes + tenant catalogue context.
// Output: { extractedProducts, suggestions } persisted onto
//         ExtractionDraft.extractedProducts.
//
// Pipeline:
//   1. Heuristic parser (existing, deterministic).
//   2. Envelope shim (heuristic-to-envelope.ts) → ExtractedProduct[].
//   3. Suggestion layer:
//        a. Benefit-group predicates from plan eligibility text.
//        b. Default plan eligibility matrix (group → product → plan).
//        c. Missing-field detection against EmployeeSchema.
//        d. Reconciliation (computed totals vs declared).
//   4. Optional LLM normalization — only runs when TenantAiProvider
//      is configured. Skipped here for the foundation slice; the
//      hook is left explicit so wiring it later changes nothing else.
//
// The LLM call is deliberately *additive*: it can boost confidence,
// fill nulls, and rename plan codes, but it cannot replace cells the
// heuristic already pulled at confidence 1.0.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';
import { type ParseResult, type ParsingRules, parsePlacementSlip } from '@/server/ingestion/parser';
import {
  type CatalogueLookup,
  type ExtractedProduct,
  envelopeFromParseResult,
} from './heuristic-to-envelope';
import { type BenefitGroupSuggestion, suggestBenefitGroups } from './predicate-suggester';
import { type ReconciliationReport, reconcile } from './reconciliation';

export type ExtractionSuggestions = {
  benefitGroups: BenefitGroupSuggestion[];
  // group raw label → suggested default plan per product
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
    referencedBy: string[]; // group labels
    enumValues?: string[];
  }>;
  reconciliation: ReconciliationReport;
};

export type ExtractionResult = {
  parseResult: ParseResult;
  extractedProducts: ExtractedProduct[];
  suggestions: ExtractionSuggestions;
};

type EmployeeField = {
  name: string;
  label: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum';
  enumValues?: string[];
  selectableForPredicates?: boolean;
  enabled?: boolean;
  tier?: 'BUILTIN' | 'STANDARD' | 'CUSTOM';
};

// Pulls the catalogue context the extractor needs from the tenant DB.
// Cheap — three short queries — but cached on a per-call basis.
async function loadCatalogueContext(db: TenantDb): Promise<{
  catalogue: CatalogueLookup;
  parsingRulesPerProduct: { productTypeCode: string; rules: Record<string, ParsingRules> }[];
  employeeFields: EmployeeField[];
}> {
  const [productTypes, employeeSchema] = await Promise.all([
    db.productType.findMany({
      select: { code: true, premiumStrategy: true, parsingRules: true },
    }),
    db.employeeSchema.findFirst({ select: { fields: true } }),
  ]);
  const employeeFields = (employeeSchema?.fields as EmployeeField[] | null) ?? [];
  const catalogue: CatalogueLookup = {
    productTypeStrategy: {},
    parsingRules: {},
  };
  const parsingRulesPerProduct: {
    productTypeCode: string;
    rules: Record<string, ParsingRules>;
  }[] = [];
  for (const pt of productTypes) {
    catalogue.productTypeStrategy[pt.code] = pt.premiumStrategy;
    const rulesObj =
      pt.parsingRules && typeof pt.parsingRules === 'object' && !Array.isArray(pt.parsingRules)
        ? ((pt.parsingRules as { templates?: Record<string, ParsingRules> }).templates ?? {})
        : {};
    catalogue.parsingRules[pt.code] = rulesObj;
    if (Object.keys(rulesObj).length > 0) {
      parsingRulesPerProduct.push({ productTypeCode: pt.code, rules: rulesObj });
    }
  }
  return { catalogue, parsingRulesPerProduct, employeeFields };
}

export async function extractFromWorkbook(db: TenantDb, buffer: Buffer): Promise<ExtractionResult> {
  const { catalogue, parsingRulesPerProduct, employeeFields } = await loadCatalogueContext(db);

  // Stage 1 — deterministic parser.
  const parseResult = await parsePlacementSlip(buffer, parsingRulesPerProduct);

  // Stage 2 — envelope shape.
  const extractedProducts = envelopeFromParseResult(parseResult, catalogue);

  // Stage 3 — suggestions layered on top.
  const benefitGroups = suggestBenefitGroups(extractedProducts, employeeFields);

  // Default plan eligibility matrix: each group label → first plan
  // whose name shares the most tokens with the group label, per product.
  // Naive but useful — the broker confirms in the Eligibility section.
  const eligibilityMatrix = benefitGroups.map((g) => {
    const prefix = g.sourcePlanLabel.toLowerCase().slice(0, 8);
    return {
      groupRawLabel: g.sourcePlanLabel,
      perProduct: extractedProducts.map((p) => {
        const match = p.plans.find((pl) => pl.rawName.toLowerCase().includes(prefix));
        return {
          productTypeCode: p.productTypeCode,
          defaultPlanRawCode: match?.rawCode ?? null,
        };
      }),
    };
  });

  // Stage 3c — missing predicate fields. Walk each suggested
  // predicate and collect var-paths that don't exist in the schema.
  const knownFieldNames = new Set(employeeFields.map((f) => f.name));
  const missingMap = new Map<
    string,
    {
      fieldPath: string;
      suggestedType: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum';
      suggestedLabel: string;
      referencedBy: string[];
      enumValues?: string[];
    }
  >();
  for (const g of benefitGroups) {
    const { varRefs, enumValues: enumsFromPredicate } = walkJsonLogic(g.predicate);
    for (const ref of varRefs) {
      if (knownFieldNames.has(ref)) continue;
      const enumVals = enumsFromPredicate.get(ref);
      let entry = missingMap.get(ref);
      if (!entry) {
        const suggestedType = enumVals ? 'enum' : guessFieldTypeFromName(ref);
        entry = {
          fieldPath: ref,
          suggestedType,
          suggestedLabel: humanizeFieldName(ref),
          referencedBy: [],
          ...(enumVals ? { enumValues: enumVals } : {}),
        };
        missingMap.set(ref, entry);
      } else if (enumVals) {
        const merged = new Set([...(entry.enumValues ?? []), ...enumVals]);
        entry.enumValues = Array.from(merged);
        entry.suggestedType = 'enum';
      }
      if (!entry.referencedBy.includes(g.sourcePlanLabel)) {
        entry.referencedBy.push(g.sourcePlanLabel);
      }
    }
  }

  // Stage 3d — reconciliation totals.
  const reconciliation = reconcile(extractedProducts);

  return {
    parseResult,
    extractedProducts,
    suggestions: {
      benefitGroups,
      eligibilityMatrix,
      missingPredicateFields: Array.from(missingMap.values()),
      reconciliation,
    },
  };
}

function extractVarPath(node: unknown): string | null {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if ('var' in obj && typeof obj.var === 'string') return obj.var;
  }
  return null;
}

// Single-pass JSONLogic walker: collects every var-path reference AND
// enum values from `==` / `in` operators in one traversal.
function walkJsonLogic(node: unknown): { varRefs: string[]; enumValues: Map<string, string[]> } {
  const varRefs: string[] = [];
  const enumValues = new Map<string, string[]>();
  const visit = (n: unknown) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    const obj = n as Record<string, unknown>;
    if ('var' in obj && typeof obj.var === 'string') {
      varRefs.push(obj.var);
      return;
    }
    if ('==' in obj) {
      const pair = obj['=='];
      if (Array.isArray(pair) && pair.length === 2) {
        const [a, b] = pair;
        const varPath = extractVarPath(a);
        if (varPath) {
          varRefs.push(varPath);
          if (typeof b === 'string') {
            const existing = enumValues.get(varPath) ?? [];
            if (!existing.includes(b)) existing.push(b);
            enumValues.set(varPath, existing);
          }
        }
      }
      return;
    }
    if ('in' in obj) {
      const pair = obj.in;
      if (Array.isArray(pair) && pair.length === 2) {
        const [a, b] = pair;
        const varPath = extractVarPath(a);
        if (varPath) {
          varRefs.push(varPath);
          if (Array.isArray(b)) {
            const vals = b.filter((v): v is string => typeof v === 'string');
            if (vals.length > 0) {
              const existing = enumValues.get(varPath) ?? [];
              for (const v of vals) {
                if (!existing.includes(v)) existing.push(v);
              }
              enumValues.set(varPath, existing);
            }
          }
        }
      }
      return;
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(node);
  return { varRefs, enumValues };
}

function guessFieldTypeFromName(
  path: string,
): 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum' {
  const lower = path.toLowerCase();
  if (/grade|level|count|year|age/.test(lower)) return 'integer';
  if (/firefighter|bargainable|manual_worker|is_|has_/.test(lower)) return 'boolean';
  if (/date/.test(lower)) return 'date';
  if (/country|region|type|class|status/.test(lower)) return 'enum';
  return 'string';
}

function humanizeFieldName(path: string): string {
  return path
    .replace(/^employee\./, '')
    .split('_')
    .map((w) => (w.length > 0 ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
