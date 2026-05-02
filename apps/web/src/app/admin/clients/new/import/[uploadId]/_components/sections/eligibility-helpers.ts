import type { WizardExtractedProduct, WizardSuggestions } from './_types';

export const INELIGIBLE = '__INELIGIBLE__';

export type GroupOverride = {
  included: boolean;
  rename?: string | null;
  description?: string | null;
  predicate?: Record<string, unknown> | null;
  defaultPlanByProduct?: Record<string, string | null>;
  mergedFrom?: string[];
};

export type EligibilityOverride = {
  groups: Record<string, GroupOverride>;
};

export type DerivedCategory = {
  key: string;
  displayName: string;
  description: string;
  predicate: Record<string, unknown>;
  tokenMatches: number;
  sourceSuggestions: string[];
};

export type ProductAssignmentRow = {
  categoryKey: string;
  categoryName: string;
  aiSuggestedPlan: string | null;
  brokerOverridePlan: string | null;
  effectivePlan: string | null;
};

type ProductPlanMap = {
  productTypeCode: string;
  insurerCode: string;
  plans: WizardExtractedProduct['plans'];
  assignments: ProductAssignmentRow[];
};

export function deriveEmployeeCategories(suggestions: WizardSuggestions): DerivedCategory[] {
  const byFingerprint = new Map<string, DerivedCategory>();

  for (const g of suggestions.benefitGroups) {
    const fp = predicateFingerprint(g.predicate);

    if (fp === '{}') {
      byFingerprint.set(`__empty_${g.suggestedName}`, {
        key: g.suggestedName,
        displayName: g.suggestedName,
        description: g.description,
        predicate: g.predicate,
        tokenMatches: g.tokenMatches,
        sourceSuggestions: [g.suggestedName],
      });
      continue;
    }

    const existing = byFingerprint.get(fp);
    if (existing) {
      const merged: DerivedCategory = {
        ...existing,
        sourceSuggestions: [...existing.sourceSuggestions, g.suggestedName],
      };
      if (g.tokenMatches > existing.tokenMatches) {
        merged.displayName = g.suggestedName;
        merged.description = g.description;
        merged.tokenMatches = g.tokenMatches;
      }
      byFingerprint.set(fp, merged);
    } else {
      byFingerprint.set(fp, {
        key: g.suggestedName,
        displayName: g.suggestedName,
        description: g.description,
        predicate: g.predicate,
        tokenMatches: g.tokenMatches,
        sourceSuggestions: [g.suggestedName],
      });
    }
  }

  return Array.from(byFingerprint.values());
}

export function buildProductAssignments(
  products: WizardExtractedProduct[],
  categories: DerivedCategory[],
  suggestions: WizardSuggestions,
  overrides: Record<string, GroupOverride>,
): ProductPlanMap[] {
  const matrixByLabel = new Map<string, Record<string, string | null>>();
  for (const row of suggestions.eligibilityMatrix) {
    const perProduct: Record<string, string | null> = {};
    for (const cell of row.perProduct) {
      perProduct[cell.productTypeCode] = cell.defaultPlanRawCode;
    }
    matrixByLabel.set(row.groupRawLabel, perProduct);
  }

  const nameToLabel = new Map<string, string>();
  for (const g of suggestions.benefitGroups) {
    nameToLabel.set(g.suggestedName, g.sourcePlanLabel);
  }

  const included = categories.filter((c) => {
    if (overrides[c.key]?.included !== undefined) return overrides[c.key]?.included;
    if (c.tokenMatches > 0) return true;
    for (const srcName of c.sourceSuggestions) {
      const label = nameToLabel.get(srcName);
      if (!label) continue;
      const perProduct = matrixByLabel.get(label);
      if (!perProduct) continue;
      if (Object.values(perProduct).some((v) => v != null)) return true;
    }
    return false;
  });

  return products.map((p) => ({
    productTypeCode: p.productTypeCode,
    insurerCode: p.insurerCode,
    plans: p.plans,
    assignments: included.map((c) => {
      let aiPlan: string | null = null;
      for (const srcName of c.sourceSuggestions) {
        const label = nameToLabel.get(srcName);
        if (!label) continue;
        const plan = matrixByLabel.get(label)?.[p.productTypeCode];
        if (plan) {
          aiPlan = plan;
          break;
        }
      }

      const brokerPlan = overrides[c.key]?.defaultPlanByProduct?.[p.productTypeCode] ?? null;
      const effective = brokerPlan ?? aiPlan;
      const displayName = overrides[c.key]?.rename ?? c.displayName;

      return {
        categoryKey: c.key,
        categoryName: displayName,
        aiSuggestedPlan: aiPlan,
        brokerOverridePlan: brokerPlan,
        effectivePlan: effective,
      };
    }),
  }));
}

export function renderPredicate(node: unknown): string {
  if (node == null) return '—';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(renderPredicate).join(', ');
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '—';
  const op = keys[0];
  const args = obj[op as string] as unknown[];
  if (op === 'var' && typeof obj.var === 'string') return obj.var;
  if (op === 'and' || op === 'or') {
    const joiner = op === 'and' ? ' AND ' : ' OR ';
    return `(${(args as unknown[]).map(renderPredicate).join(joiner)})`;
  }
  if (op === '==' || op === '!=' || op === '>=' || op === '<=' || op === '>' || op === '<') {
    const [a, b] = args as [unknown, unknown];
    return `${renderPredicate(a)} ${op} ${renderPredicate(b)}`;
  }
  if (op === 'in') {
    const [needle, haystack] = args as [unknown, unknown];
    return `${renderPredicate(needle)} in [${renderPredicate(haystack)}]`;
  }
  return JSON.stringify(node);
}

function predicateFingerprint(pred: Record<string, unknown>): string {
  return JSON.stringify(pred);
}
