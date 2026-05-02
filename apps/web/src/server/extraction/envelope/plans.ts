// Plan shape helpers — code derivation, stacking sniff, schedule parsing,
// and plan-list construction from parsed plan rows.

import { COVER_BASIS_BY_STRATEGY } from '@/server/catalogue/premium-strategy';
import type { ParsedProduct } from '@/server/ingestion/parser';
import type { PlanField, SourceRef } from './types';

// Heuristic plan-code derivation. Order:
//   "Plan A: HJG 16+"   → "PA"
//   "1.5"               → "P1_5"  (numeric, decimal preserved)
//   "Executive Plus"    → "PEXECPL" (first 6 alnum chars after P-prefix)
//   "—" / unicode-only  → `P_${index+1}` (last-resort fallback)
//
// Why deterministic-from-label beats index-based: re-uploading the
// same slip with reordered sheets must produce stable plan codes.
export function derivePlanCode(label: string, index: number): string {
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  if (planMatch) return `P${planMatch[1]?.toUpperCase()}`;
  const numMatch = label.match(/^(\d+(?:[.,]\d+)?)\b/);
  if (numMatch) {
    const normalized = numMatch[1]?.replace(/[.,]/g, '_');
    return `P${normalized}`;
  }
  // Strip non-ASCII-alphanumeric, take first 6 chars as the slug.
  const slug = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6);
  if (slug.length > 0) return `P${slug}`;
  return `P_${index + 1}`;
}

// Sniff "additional above Plan X" or "additional above Plan X / Plan Y"
// → ["X"] or ["X","Y"]. Returns empty array when no stacking found.
export function sniffStacksOnFromText(text: string): string[] {
  const normalised = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  // "additional above Plan A / Plan B" or "additional above Plan A and Plan B"
  const multiM = normalised.match(
    /additional\s+above\s+Plan\s+([A-Z0-9]+)\s*(?:\/|and)\s*Plan\s+([A-Z0-9]+)/i,
  );
  if (multiM) return [(multiM[1] ?? '').toUpperCase(), (multiM[2] ?? '').toUpperCase()];
  const singleM = normalised.match(/additional\s+above\s+Plan\s+([A-Z0-9]+)/i);
  if (singleM) return [(singleM[1] ?? '').toUpperCase()];
  return [];
}

export type PlanScheduleResult = {
  basis: PlanField['coverBasis'];
  schedule: Partial<{
    multiplier: number;
    sumAssured: number;
    ratePerEmployee: number;
  }>;
};

// Comprehensive schedule pattern matching (item 2.1).
// Order matters: more-specific patterns first to avoid false positives.
export function parseScheduleFromFormula(formula: string | null): PlanScheduleResult | null {
  if (!formula) return null;
  const cleaned = formula.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Salary multiple: "36 x LDBMS", "36×Last Drawn Basic Monthly Salary"
  const multM = cleaned.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(?:LDBMS|last\s+drawn|monthly\s+salary|basic\s+monthly)/i,
  );
  if (multM) {
    const value = Number.parseFloat(multM[1] ?? '');
    if (Number.isFinite(value))
      return { basis: 'salary_multiple', schedule: { multiplier: value } };
  }

  // Per-employee flat rate: "$9.50 per insured person", "9.5 per life"
  const perEmpM = cleaned.match(
    /S?\$?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s+)?(?:insured|employee|person|life|head|pax)/i,
  );
  if (perEmpM) {
    const value = Number.parseFloat((perEmpM[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value))
      return { basis: 'per_employee_flat', schedule: { ratePerEmployee: value } };
  }

  // Fixed sum assured: "$50,000" or "S$50,000" or bare "50000"
  const fixedM = cleaned.match(/^S?\$?\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (fixedM) {
    const value = Number.parseFloat((fixedM[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value)) return { basis: 'fixed_amount', schedule: { sumAssured: value } };
  }

  return null;
}

// Build PlanField[] from a parsed product's plan rows.
export function buildPlans(
  parsed: ParsedProduct,
  productTypeStrategy: string | null,
  headerSourceRef: (label: string) => SourceRef,
): PlanField[] {
  const coverBasis: PlanField['coverBasis'] =
    (productTypeStrategy ? COVER_BASIS_BY_STRATEGY[productTypeStrategy] : null) ?? 'fixed_amount';

  return parsed.plans.map((p, i) => {
    const label = String(p.code).trim();
    const code = derivePlanCode(label, i);

    // Multi-parent stacking: prefer explicit parser hint, then sniff from label.
    const stacksOnRawCodes: string[] = p.stacksOnLabel
      ? [
          p.stacksOnLabel
            .replace(/^Plan\s+/i, '')
            .trim()
            .toUpperCase(),
        ]
      : sniffStacksOnFromText(label);

    // Schedule: try the comprehensive formula parser first (works on the
    // full label text), then fall back to the product-level coverBasis.
    const scheduleResult = parseScheduleFromFormula(label);
    let effectiveCoverBasis = coverBasis;
    let schedule: Record<string, unknown> = {};
    if (scheduleResult) {
      effectiveCoverBasis = scheduleResult.basis;
      schedule = scheduleResult.schedule;
    }

    return {
      rawCode: label,
      rawName: label,
      code,
      name: label,
      coverBasis: effectiveCoverBasis,
      stacksOnRawCode: stacksOnRawCodes[0] ?? null, // deprecated singular
      stacksOnRawCodes,
      selectionMode: 'broker_default',
      schedule,
      confidence: 0.9,
      sourceRef: headerSourceRef('plans-block'),
    };
  });
}
