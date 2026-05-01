// =============================================================
// predicate-suggester — eligibility categories → JSONLogic predicate
// referencing the tenant's actual EmployeeSchema fields.
//
// Pattern matching is delegated to predicate-patterns.ts so the
// suggester and the heuristic parser cannot drift on field names
// or operators. Anything not recognised by the patterns surfaces
// as a `{}` predicate; the wizard's Schema Additions section can
// still propose CUSTOM fields if the LLM stage suggests them.
//
// The crucial rule: never invent field names. Every "var" in the
// emitted predicate must exist in the tenant's EmployeeSchema, OR
// be flagged as a MISSING_PREDICATE_FIELD issue so the wizard's
// Schema Additions section can offer to add it.
// =============================================================

import type { ExtractedProduct } from './heuristic-to-envelope';
import { inferPredicateFromText } from './predicate-patterns';

export type BenefitGroupSuggestion = {
  sourcePlanLabel: string;
  suggestedName: string;
  description: string;
  predicate: Record<string, unknown>;
  tokenMatches: number;
};

// Derives benefit group suggestions from the per-product
// eligibility.categories field. Cross-product de-dupe by
// normalised category label so "Board of Directors" appearing
// on GTL, GHS, GMM, GPA only emits one BenefitGroup row.
export function suggestBenefitGroups(
  extractedProducts: ExtractedProduct[],
  _employeeFields: unknown[],
): BenefitGroupSuggestion[] {
  const seen = new Map<string, BenefitGroupSuggestion>();

  for (const product of extractedProducts) {
    const categories = product.eligibility?.categories ?? [];
    for (const cat of categories) {
      const label = cat.category.replace(/\s+/g, ' ').trim();
      if (!label) continue;
      const normalised = label.toLowerCase();
      if (seen.has(normalised)) continue;
      const { predicate, matchCount } = inferPredicateFromText(label);
      seen.set(normalised, {
        sourcePlanLabel: label,
        suggestedName: label,
        description: `Category: ${label}${cat.sumInsuredFormula ? ` (${cat.sumInsuredFormula})` : ''}`,
        predicate,
        tokenMatches: matchCount,
      });
    }

    // Fallback: if a product has no categories but has plans, use plan
    // labels as benefit group hints (backward-compat with older extractions).
    if (categories.length === 0) {
      for (const plan of product.plans) {
        const label = plan.rawName.replace(/\s+/g, ' ').trim();
        if (!label) continue;
        const normalised = label.toLowerCase();
        if (seen.has(normalised)) continue;
        const { predicate, matchCount } = inferPredicateFromText(label);
        seen.set(normalised, {
          sourcePlanLabel: label,
          suggestedName: deriveGroupName(label),
          description: label,
          predicate,
          tokenMatches: matchCount,
        });
      }
    }
  }
  return Array.from(seen.values());
}

function deriveGroupName(label: string): string {
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  if (planMatch) return `Plan ${planMatch[1]?.toUpperCase()} eligible`;
  const numMatch = label.match(/^(\d+)\b/);
  if (numMatch) return `Plan ${numMatch[1]} eligible`;
  return label.slice(0, 40);
}
