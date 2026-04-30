// =============================================================
// EligibilitySection — surfaces the AI-suggested benefit groups
// (predicates) and the default-plan eligibility matrix. Brokers
// confirm or strike each group; matrix cells let them pick a
// different default plan or mark the group ineligible.
//
// The predicate human-rendering walks JSONLogic and prints a
// short, scannable summary (no JSON in the broker's eye line).
// =============================================================

'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { useMemo, useState } from 'react';
import {
  type WizardExtractedProduct,
  type WizardSuggestions,
  extractedProductsFromDraft,
  suggestionsFromDraft,
} from './_types';

type Props = {
  draft: { extractedProducts: unknown; progress: unknown };
};

export function EligibilitySection({ draft }: Props) {
  const products = extractedProductsFromDraft(draft.extractedProducts);
  const suggestions = suggestionsFromDraft(draft.progress);
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of suggestions.benefitGroups) {
      // Suggestions with at least one matched token are confirmed by
      // default; pure-zero matches stay opt-in to avoid false positives.
      init[g.suggestedName] = g.tokenMatches > 0;
    }
    return init;
  });

  const includedCount = Object.values(included).filter(Boolean).length;

  return (
    <>
      <h2>Eligibility</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Suggested benefit groups ({suggestions.benefitGroups.length})</h3>
          {suggestions.benefitGroups.length === 0 ? (
            <p className="field-help mb-0">
              No predicate suggestions yet. Either the slip&rsquo;s plan labels carried no
              recognisable eligibility tokens, or the LLM stage hasn&rsquo;t enriched the draft.
            </p>
          ) : (
            <>
              <p className="field-help mb-3">
                Each row is a predicate suggested from a plan&rsquo;s label. Confirm the ones to
                create on Apply. Predicates referencing fields not in your employee schema are
                flagged in the Schema additions section.
              </p>
              <ul className="issue-list">
                {suggestions.benefitGroups.map((g) => (
                  <li
                    key={g.suggestedName}
                    className={
                      g.tokenMatches === 0 ? 'issue is-warning' : 'issue is-info'
                    }
                  >
                    <label className="row" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={included[g.suggestedName] ?? false}
                        onChange={(e) =>
                          setIncluded((prev) => ({ ...prev, [g.suggestedName]: e.target.checked }))
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <strong>{g.suggestedName}</strong>{' '}
                        <ConfidenceBadge
                          confidence={g.tokenMatches > 0 ? 0.85 : 0.3}
                          variant="dot"
                        />
                        <div className="field-help">{g.description}</div>
                        <div style={{ marginTop: '0.25rem' }}>
                          <code className="text-mono-xs">{renderPredicate(g.predicate)}</code>
                        </div>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">
            Default-plan matrix ({includedCount} groups × {products.length} products)
          </h3>
          {includedCount === 0 || products.length === 0 ? (
            <p className="field-help mb-0">
              {includedCount === 0
                ? 'Tick at least one suggested group above to populate the matrix.'
                : 'No extracted products — nothing to map eligibility against.'}
            </p>
          ) : (
            <Matrix
              suggestions={suggestions}
              products={products}
              included={included}
            />
          )}
        </Card>
      </section>
    </>
  );
}

function Matrix({
  suggestions,
  products,
  included,
}: {
  suggestions: WizardSuggestions;
  products: WizardExtractedProduct[];
  included: Record<string, boolean>;
}) {
  const includedGroups = suggestions.benefitGroups.filter((g) => included[g.suggestedName]);
  const matrixByGroup = useMemo(() => {
    const m = new Map<string, Record<string, string | null>>();
    for (const row of suggestions.eligibilityMatrix) {
      const perProduct: Record<string, string | null> = {};
      for (const cell of row.perProduct) {
        perProduct[cell.productTypeCode] = cell.defaultPlanRawCode;
      }
      m.set(row.groupRawLabel, perProduct);
    }
    return m;
  }, [suggestions.eligibilityMatrix]);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Group ↓ / Product →</th>
            {products.map((p) => (
              <th key={`${p.productTypeCode}-${p.insurerCode}`}>
                <code>{p.productTypeCode}</code>
                <div className="field-help">{p.insurerCode}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {includedGroups.map((g) => {
            // Matrix is keyed by sourcePlanLabel — same value as the
            // suggestion's `description` today, but pinning to the
            // canonical key avoids a silent mismatch if `description`
            // ever turns into a human-friendly label.
            const row = matrixByGroup.get(g.sourcePlanLabel) ?? {};
            return (
              <tr key={g.suggestedName}>
                <td>
                  <strong>{g.suggestedName}</strong>
                </td>
                {products.map((p) => {
                  const defaultRawCode = row[p.productTypeCode];
                  const matchedPlan = defaultRawCode
                    ? p.plans.find((pl) => pl.rawCode === defaultRawCode || pl.code === defaultRawCode)
                    : null;
                  return (
                    <td key={p.productTypeCode}>
                      {matchedPlan ? (
                        <span className="pill pill-success">
                          <code>{matchedPlan.code}</code>
                        </span>
                      ) : (
                        <span className="pill pill-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// JSONLogic → English-ish. Handles the common shapes the predicate-
// suggester emits today; falls back to the JSON for anything more
// exotic. Will be replaced by a generic renderer in a later slice.
function renderPredicate(node: unknown): string {
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
