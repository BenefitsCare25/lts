// =============================================================
// predicate-suggester — eligibility text → JSONLogic predicate
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
  // The plan whose label seeded the suggestion.
  sourcePlanLabel: string;
  // Suggested name for the eventual BenefitGroup row.
  suggestedName: string;
  // Suggested description / source breadcrumb.
  description: string;
  // JSONLogic. {} means "no confident pattern matched — write by hand".
  predicate: Record<string, unknown>;
  // Number of recognised tokens; loosely a confidence proxy.
  tokenMatches: number;
};

// Top-level — one suggestion per unique plan label across all
// extracted products. Cross-product de-dupe on label so STM's
// GHS / GMM / SP / GPA carrying the same "Hay Job Grade 18+"
// label only emit one BenefitGroup row.
export function suggestBenefitGroups(
  extractedProducts: ExtractedProduct[],
  // Reserved for the LLM stage: when employee fields differ from the
  // pattern-table assumptions, the LLM remaps. Today unused.
  _employeeFields: unknown[],
): BenefitGroupSuggestion[] {
  const seen = new Map<string, BenefitGroupSuggestion>();
  for (const product of extractedProducts) {
    for (const plan of product.plans) {
      const label = plan.rawName.replace(/\s+/g, ' ').trim();
      if (!label || seen.has(label)) continue;
      const { predicate, matchCount } = inferPredicateFromText(label);
      seen.set(label, {
        sourcePlanLabel: label,
        suggestedName: deriveGroupName(label),
        description: label,
        predicate,
        tokenMatches: matchCount,
      });
    }
  }
  return Array.from(seen.values());
}

function deriveGroupName(label: string): string {
  // "Plan A: Hay Job Grade 16 and above" → "Plan A eligible"
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  if (planMatch) return `Plan ${planMatch[1]?.toUpperCase()} eligible`;
  // numeric prefix "1 ..." → "Plan 1 eligible"
  const numMatch = label.match(/^(\d+)\b/);
  if (numMatch) return `Plan ${numMatch[1]} eligible`;
  // Fallback — first 40 chars.
  return label.slice(0, 40);
}
