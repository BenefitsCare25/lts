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
  // Labels from other products that were merged into this group.
  // The matrix builder tries these when the primary label doesn't
  // match a product's eligibility category exactly.
  aliasLabels?: string[];
};

type CollectedCategory = {
  label: string;
  sumInsuredFormula: string | null;
  planCode: string | null;
  productTypeCode: string;
};

// Derives benefit group suggestions from the per-product
// eligibility.categories field. Cross-product de-dupe uses a
// two-phase approach: exact label match first, then grade-key
// normalization to merge labels like "Grade 80 & 90 (incl.
// outgoing postees & STA)" with "Grade 80 - 90".
export function suggestBenefitGroups(
  extractedProducts: ExtractedProduct[],
  _employeeFields: unknown[],
): BenefitGroupSuggestion[] {
  // Phase 1: collect unique categories across all products.
  const seenExact = new Set<string>();
  const categories: CollectedCategory[] = [];

  for (const product of extractedProducts) {
    const cats = product.eligibility?.categories ?? [];
    for (const cat of cats) {
      const label = cat.category.replace(/\s+/g, ' ').trim();
      if (!label) continue;
      const norm = label.toLowerCase();
      if (seenExact.has(norm)) continue;
      seenExact.add(norm);
      categories.push({
        label,
        sumInsuredFormula: cat.sumInsuredFormula ?? null,
        planCode: cat.defaultPlanRawCode ?? null,
        productTypeCode: product.productTypeCode,
      });
    }

    // Fallback: if a product has no categories but has plans, use plan
    // labels as benefit group hints (backward-compat with older extractions).
    if (cats.length === 0) {
      for (const plan of product.plans) {
        const label = plan.rawName.replace(/\s+/g, ' ').trim();
        if (!label) continue;
        const norm = label.toLowerCase();
        if (seenExact.has(norm)) continue;
        seenExact.add(norm);
        categories.push({
          label,
          sumInsuredFormula: null,
          planCode: null,
          productTypeCode: product.productTypeCode,
        });
      }
    }
  }

  // Phase 2: merge categories with the same grade key.
  type MergedGroup = {
    canonical: CollectedCategory;
    aliases: CollectedCategory[];
  };
  const groups: MergedGroup[] = [];
  const gradeKeyIndex = new Map<string, number>();

  for (const cat of categories) {
    const gKey = extractGradeKey(cat.label);
    if (gKey && gradeKeyIndex.has(gKey)) {
      const idx = gradeKeyIndex.get(gKey) as number;
      (groups[idx] as MergedGroup).aliases.push(cat);
      continue;
    }
    const idx = groups.length;
    groups.push({ canonical: cat, aliases: [] });
    if (gKey) gradeKeyIndex.set(gKey, idx);
  }

  // Phase 2b: prefix-dedup for non-grade labels. Labels that are pure
  // prefixes of other labels (min 40 chars) represent the same population
  // with extra annotations. Keep the shortest as canonical.
  for (let i = 0; i < groups.length; i++) {
    const gi = groups[i];
    if (!gi || extractGradeKey(gi.canonical.label)) continue; // handled by grade-key
    for (let j = groups.length - 1; j > i; j--) {
      const gj = groups[j];
      if (!gj || extractGradeKey(gj.canonical.label)) continue;
      const shorter = gi.canonical.label.length <= gj.canonical.label.length ? gi : gj;
      const longer = gi.canonical.label.length <= gj.canonical.label.length ? gj : gi;
      if (
        shorter.canonical.label.length >= 40 &&
        longer.canonical.label.toLowerCase().startsWith(shorter.canonical.label.toLowerCase())
      ) {
        shorter.aliases.push(longer.canonical, ...longer.aliases);
        longer.canonical = { ...longer.canonical, label: '' };
      }
    }
  }
  // Remove merged groups (marked with empty label).
  for (let i = groups.length - 1; i >= 0; i--) {
    if ((groups[i] as { canonical: CollectedCategory }).canonical.label === '') {
      groups.splice(i, 1);
    }
  }

  // Phase 3: merge orphan WP/SP-only labels with their grade+WP/SP
  // counterpart. Example: "Work Permit & S-Pass workers" (no grade)
  // and "Grade 30 & below (Work Permit & S Pass)" (has grade) are
  // the same population when they share the same plan code.
  mergeOrphanWpSpGroups(groups);

  // Phase 4: build suggestions from merged groups.
  return groups.map((g) => {
    const { predicate, matchCount } = inferPredicateFromText(g.canonical.label);
    const aliasLabels = g.aliases.map((a) => a.label);
    return {
      sourcePlanLabel: g.canonical.label,
      suggestedName: g.canonical.label,
      description: `Category: ${g.canonical.label}${g.canonical.sumInsuredFormula ? ` (${g.canonical.sumInsuredFormula})` : ''}`,
      predicate,
      tokenMatches: matchCount,
      ...(aliasLabels.length > 0 ? { aliasLabels } : {}),
    };
  });
}

// Extracts a normalised key from grade-based category labels.
// "Grade 80 & 90 (incl. outgoing postees & STA)" and "Grade 80 -
// 90" both produce "g80-90", allowing them to merge.
function extractGradeKey(label: string): string | null {
  const lower = label.toLowerCase();
  if (!/grade\b/.test(lower)) return null;

  const nums = lower.match(/\b(\d{2,})\b/g);
  if (!nums || nums.length === 0) return null;

  const hasBelow = /below|under/i.test(lower);
  const hasAbove = /above|over/i.test(lower);
  const hasWp = /work\s*permit|s[\s-]*pass/i.test(lower);

  const parts = ['g', ...nums.sort()];
  if (hasBelow) parts.push('below');
  if (hasAbove) parts.push('above');
  if (hasWp) parts.push('wp');
  return parts.join('-');
}

// Merges groups that are WP/SP-only (no grade prefix) with groups
// that are grade+WP/SP, when they share the same plan code in
// different products. E.g. "Work Permit & S-Pass workers" (GMM,
// plan A1) merges with "Grade 30 & below (Work Permit & S Pass)"
// (GP, plan A1).
function mergeOrphanWpSpGroups(
  groups: { canonical: CollectedCategory; aliases: CollectedCategory[] }[],
): void {
  const isWpLabel = (label: string) => /work\s*permit|s[\s-]*pass/i.test(label);
  const hasGrade = (label: string) => /grade\b/i.test(label);

  const orphanWpIndices: number[] = [];
  const gradeWpIndices: number[] = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i] as { canonical: CollectedCategory; aliases: CollectedCategory[] };
    const lbl = g.canonical.label;
    if (!isWpLabel(lbl)) continue;
    if (hasGrade(lbl)) gradeWpIndices.push(i);
    else orphanWpIndices.push(i);
  }

  for (const oi of orphanWpIndices) {
    const orphan = groups[oi] as { canonical: CollectedCategory; aliases: CollectedCategory[] };
    const orphanPlan = orphan.canonical.planCode;
    if (!orphanPlan) continue;

    for (const gi of gradeWpIndices) {
      const gradeGroup = groups[gi] as {
        canonical: CollectedCategory;
        aliases: CollectedCategory[];
      };
      const allCats = [gradeGroup.canonical, ...gradeGroup.aliases];
      const matchesPlan = allCats.some(
        (c) => c.planCode === orphanPlan && c.productTypeCode !== orphan.canonical.productTypeCode,
      );
      if (!matchesPlan) continue;

      // Merge orphan into the grade group. Keep the grade-based label
      // as canonical (more descriptive), add orphan as alias.
      gradeGroup.aliases.push(orphan.canonical, ...orphan.aliases);
      // Mark orphan for removal by clearing its canonical label.
      orphan.canonical = { ...orphan.canonical, label: '' };
      break;
    }
  }

  // Remove merged orphans.
  for (let i = groups.length - 1; i >= 0; i--) {
    if ((groups[i] as { canonical: CollectedCategory }).canonical.label === '') {
      groups.splice(i, 1);
    }
  }
}
