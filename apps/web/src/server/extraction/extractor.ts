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

  // Default plan eligibility matrix: maps each benefit group to its
  // default plan per product using the category→plan mapping from
  // eligibility.categories[].defaultPlanRawCode.
  const eligibilityMatrix = buildEligibilityMatrix(benefitGroups, extractedProducts);

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

// ── Grade-range utilities for cross-product matching ─────────
type GradeRange = {
  min: number;
  max: number; // Infinity for "and above"
  isForeignWorker: boolean;
};

function parseGradeRange(label: string): GradeRange | null {
  const lower = label.toLowerCase();
  if (!/\bgrade\b/.test(lower)) return null;

  const nums = [...lower.matchAll(/\b(\d{2,})\b/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;

  const hasAbove = /\b(?:above|over)\b/.test(lower);
  const hasBelow = /\b(?:below|under)\b/.test(lower);
  const isFw = /work\s*permit|s[\s-]*pass|foreign\s*worker/.test(lower);

  let min: number;
  let max: number;
  if (hasAbove && !hasBelow) {
    min = nums[0]!;
    max = Infinity;
  } else if (hasBelow && !hasAbove) {
    min = 0;
    max = nums[nums.length - 1]!;
  } else if (nums.length >= 2) {
    min = nums[0]!;
    max = nums[nums.length - 1]!;
  } else {
    min = nums[0]!;
    max = nums[0]!;
  }

  return { min, max, isForeignWorker: isFw };
}

function gradeRangeContains(outer: GradeRange, inner: GradeRange): boolean {
  if (outer.isForeignWorker !== inner.isForeignWorker) return false;
  return inner.min >= outer.min && inner.max <= outer.max;
}

function gradeRangeOverlap(a: GradeRange, b: GradeRange): number {
  if (a.isForeignWorker !== b.isForeignWorker) return 0;
  const capA = a.max === Infinity ? 999 : a.max;
  const capB = b.max === Infinity ? 999 : b.max;
  const lo = Math.max(a.min, b.min);
  const hi = Math.min(capA, capB);
  return hi >= lo ? hi - lo + 1 : 0;
}

// Builds the eligibility matrix mapping benefit groups to their default
// plan per product. Uses the category→plan linkage from
// eligibility.categories[].defaultPlanRawCode which the AI extraction
// populates directly from the slip's "Basis of Cover" sections.
//
// Five-pass resolution:
//   1. Exact label match.
//   2. Prefix match (≥15 chars) for label variants across products.
//   3. Grade-range containment — Grade 18+ ⊂ Grade 16+ → assign plan.
//   4. Best grade overlap — Grade 08-17 has 80% overlap with Grade 08-15.
//   5. Employment-type keyword fallback (e.g. "bargainable").
export function buildEligibilityMatrix(
  benefitGroups: BenefitGroupSuggestion[],
  products: ExtractedProduct[],
): ExtractionSuggestions['eligibilityMatrix'] {
  // Build a per-product lookup: normalised category label → defaultPlanRawCode
  const productCategoryPlans = new Map<string, Map<string, string>>();
  for (const p of products) {
    const catMap = new Map<string, string>();
    for (const cat of p.eligibility?.categories ?? []) {
      if (cat.defaultPlanRawCode) {
        catMap.set(cat.category.replace(/\s+/g, ' ').trim().toLowerCase(), cat.defaultPlanRawCode);
      }
    }
    productCategoryPlans.set(p.productTypeCode, catMap);
  }

  return benefitGroups.map((g) => {
    const labels = [g.sourcePlanLabel, ...(g.aliasLabels ?? [])].map((l) => l.toLowerCase());
    return {
      groupRawLabel: g.sourcePlanLabel,
      perProduct: products.map((p) => {
        const catMap = productCategoryPlans.get(p.productTypeCode);
        if (!catMap) return { productTypeCode: p.productTypeCode, defaultPlanRawCode: null };

        // Pass 1: exact match.
        for (const label of labels) {
          const planCode = catMap.get(label);
          if (planCode) return { productTypeCode: p.productTypeCode, defaultPlanRawCode: planCode };
        }

        // Pass 2: prefix match. Different products sometimes label the same population
        // with different amounts of detail — e.g. SP says "Grade 18 and above and their
        // Eligible Dependents (Local Plans & FW Plans)" while GHS says just "Grade 18 and
        // above". Accept a match when one string is a prefix of the other and the shorter
        // one is at least 15 chars (guards against trivially short common prefixes).
        for (const label of labels) {
          for (const [catLabel, planCode] of catMap) {
            const shorter = label.length <= catLabel.length ? label : catLabel;
            const longer = label.length <= catLabel.length ? catLabel : label;
            if (shorter.length >= 15 && longer.startsWith(shorter)) {
              return { productTypeCode: p.productTypeCode, defaultPlanRawCode: planCode };
            }
          }
        }

        // Pass 3 + 4: grade-range matching. Different products use
        // different grade cutoffs for overlapping populations — e.g.
        // GHS "Grade 18+" vs GTL "Grade 16+". Pass 3 handles full
        // containment (18+ ⊂ 16+). Pass 4 picks the category with
        // the largest overlap when containment fails (e.g. "Grade
        // 08-17" overlaps 80% with GTL "Grade 08-15").
        const groupGrade = labels.reduce<GradeRange | null>(
          (acc, l) => acc ?? parseGradeRange(l),
          null,
        );
        if (groupGrade) {
          let bestPlan: string | null = null;
          let bestOverlap = 0;
          for (const [catLabel, planCode] of catMap) {
            const catGrade = parseGradeRange(catLabel);
            if (!catGrade) continue;
            if (gradeRangeContains(catGrade, groupGrade)) {
              return { productTypeCode: p.productTypeCode, defaultPlanRawCode: planCode };
            }
            const overlap = gradeRangeOverlap(groupGrade, catGrade);
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestPlan = planCode;
            }
          }
          if (bestPlan) {
            return { productTypeCode: p.productTypeCode, defaultPlanRawCode: bestPlan };
          }
        }

        // Pass 5: employment-type keyword fallback for non-grade
        // categories. "Bargainable Employees" should match a product
        // category that also covers bargainable staff (e.g. GTL's
        // "Grade 08-15 and Bargainable Staff").
        if (!groupGrade) {
          const groupIsBargainable =
            /\bbargainable\b/i.test(labels[0]!) &&
            !/\bnon[\s-]*bargainable\b/i.test(labels[0]!);
          if (groupIsBargainable) {
            for (const [catLabel, planCode] of catMap) {
              if (
                /\bbargainable\b/i.test(catLabel) &&
                !/\bnon[\s-]*bargainable\b/i.test(catLabel)
              ) {
                return { productTypeCode: p.productTypeCode, defaultPlanRawCode: planCode };
              }
            }
          }
        }

        return { productTypeCode: p.productTypeCode, defaultPlanRawCode: null };
      }),
    };
  });
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
