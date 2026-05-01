'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useMemo, useState } from 'react';
import type { SectionId } from './_registry';
import {
  type WizardExtractedProduct,
  type WizardSuggestions,
  extractedProductsFromDraft,
  readBrokerOverride,
  suggestionsFromDraft,
} from './_types';

type Props = {
  draft: { id: string; extractedProducts: unknown; progress: unknown };
  markSectionDirty?: (id: SectionId) => void;
};

// Per-group override. Keyed by the suggestion's `suggestedName` (which
// is unique per draft). Apply (Phase 3) reads this to decide which
// BenefitGroup rows to create and what defaults to wire.
type GroupOverride = {
  included: boolean;
  rename?: string | null;
  description?: string | null;
  predicate?: Record<string, unknown> | null;
  // Per-product default plan override. Keyed by productTypeCode.
  // Value is plan rawCode, "INELIGIBLE", or null (use AI suggestion).
  defaultPlanByProduct?: Record<string, string | null>;
};

type EligibilityOverride = {
  groups: Record<string, GroupOverride>;
};

const INELIGIBLE = '__INELIGIBLE__';

export function EligibilitySection({ draft, markSectionDirty }: Props) {
  const products = extractedProductsFromDraft(draft.extractedProducts);
  const suggestions = suggestionsFromDraft(draft.progress);

  // Default included = AI's recommendation (tokenMatches > 0). Broker
  // overrides win.
  const [override, setOverride] = useState<EligibilityOverride>(() => {
    const persisted = readBrokerOverride<EligibilityOverride>(draft.progress, 'eligibility', {
      groups: {},
    });
    if (Object.keys(persisted.groups).length > 0) {
      return { groups: { ...persisted.groups } };
    }
    const init: Record<string, GroupOverride> = {};
    for (const g of suggestions.benefitGroups) {
      init[g.suggestedName] = { included: g.tokenMatches > 0 };
    }
    return { groups: init };
  });

  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  const markAutosaveDirty = useDebouncedAutosave(
    override,
    (value) => saveOverride.mutate({ draftId: draft.id, namespace: 'eligibility', value }),
    { delayMs: 600 },
  );

  const markDirty = useCallback(() => {
    markAutosaveDirty();
    markSectionDirty?.('eligibility');
  }, [markAutosaveDirty, markSectionDirty]);

  const updateGroup = useCallback(
    (name: string, patch: Partial<GroupOverride>) => {
      markDirty();
      setOverride((prev) => ({
        groups: {
          ...prev.groups,
          [name]: { ...(prev.groups[name] ?? { included: false }), ...patch },
        },
      }));
    },
    [markDirty],
  );

  const includedCount = Object.values(override.groups).filter((g) => g.included).length;

  return (
    <>
      <h2>Eligibility</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Suggested benefit groups ({suggestions.benefitGroups.length})</h3>
          {suggestions.benefitGroups.length === 0 ? (
            <p className="field-help mb-0">
              No predicate suggestions yet. Either the slip&rsquo;s plan labels carried no
              recognisable eligibility tokens, or the AI extraction hasn&rsquo;t run.
            </p>
          ) : (
            <>
              <p className="field-help mb-3">
                Each row is a predicate suggested from a plan&rsquo;s label. Confirm the ones to
                create on Apply, rename or rewrite the predicate as needed.
              </p>
              <ul className="issue-list">
                {suggestions.benefitGroups.map((g) => (
                  <BenefitGroupRow
                    key={g.suggestedName}
                    suggestion={g}
                    override={override.groups[g.suggestedName] ?? { included: false }}
                    onChange={(patch) => updateGroup(g.suggestedName, patch)}
                  />
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
              override={override}
              onChange={updateGroup}
            />
          )}
        </Card>
      </section>
    </>
  );
}

function BenefitGroupRow({
  suggestion,
  override,
  onChange,
}: {
  suggestion: WizardSuggestions['benefitGroups'][number];
  override: GroupOverride;
  onChange: (patch: Partial<GroupOverride>) => void;
}) {
  const [showPredicate, setShowPredicate] = useState(false);
  const [predicateText, setPredicateText] = useState(() =>
    JSON.stringify(override.predicate ?? suggestion.predicate, null, 2),
  );
  const [predicateError, setPredicateError] = useState<string | null>(null);

  const displayName = override.rename ?? suggestion.suggestedName;
  const displayDescription = override.description ?? suggestion.description;
  const activePredicate = override.predicate ?? suggestion.predicate;

  return (
    <li className={suggestion.tokenMatches === 0 ? 'issue is-warning' : 'issue is-info'}>
      <div className="row" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
        <input
          type="checkbox"
          checked={override.included}
          onChange={(e) => onChange({ included: e.target.checked })}
        />
        <div style={{ flex: 1 }}>
          <input
            className="input"
            type="text"
            value={displayName}
            onChange={(e) => onChange({ rename: e.target.value })}
            style={{ fontWeight: 600, marginBottom: '0.25rem' }}
          />{' '}
          <ConfidenceBadge confidence={suggestion.tokenMatches > 0 ? 0.85 : 0.3} variant="dot" />
          <input
            className="input"
            type="text"
            value={displayDescription}
            onChange={(e) => onChange({ description: e.target.value })}
            style={{ fontSize: 'var(--font-sm)', marginTop: '0.25rem' }}
            placeholder="Short broker-facing description"
          />
          <div style={{ marginTop: '0.5rem' }}>
            <code className="text-mono-xs">{renderPredicate(activePredicate)}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: '0.5rem' }}
              onClick={() => setShowPredicate((v) => !v)}
            >
              {showPredicate ? 'Hide JSON' : 'Edit predicate'}
            </button>
          </div>
          {showPredicate ? (
            <div style={{ marginTop: '0.5rem' }}>
              <textarea
                className="input"
                rows={6}
                value={predicateText}
                onChange={(e) => setPredicateText(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-sm)' }}
                spellCheck={false}
              />
              {predicateError ? (
                <p className="field-error" style={{ marginTop: '0.25rem' }}>
                  {predicateError}
                </p>
              ) : null}
              <div className="row" style={{ gap: '0.25rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(predicateText);
                      if (typeof parsed !== 'object' || parsed === null) {
                        setPredicateError('Predicate must be a JSON object.');
                        return;
                      }
                      setPredicateError(null);
                      onChange({ predicate: parsed as Record<string, unknown> });
                    } catch (err) {
                      setPredicateError(
                        `Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
                      );
                    }
                  }}
                >
                  Apply predicate
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPredicateText(JSON.stringify(suggestion.predicate, null, 2));
                    onChange({ predicate: null });
                    setPredicateError(null);
                  }}
                >
                  Reset to AI suggestion
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Matrix({
  suggestions,
  products,
  override,
  onChange,
}: {
  suggestions: WizardSuggestions;
  products: WizardExtractedProduct[];
  override: EligibilityOverride;
  onChange: (name: string, patch: Partial<GroupOverride>) => void;
}) {
  const includedGroups = suggestions.benefitGroups.filter(
    (g) => override.groups[g.suggestedName]?.included,
  );
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
            const aiRow = matrixByGroup.get(g.sourcePlanLabel) ?? {};
            const groupOverride = override.groups[g.suggestedName] ?? { included: true };
            const overrides = groupOverride.defaultPlanByProduct ?? {};
            return (
              <tr key={g.suggestedName}>
                <td>
                  <strong>{groupOverride.rename ?? g.suggestedName}</strong>
                </td>
                {products.map((p) => {
                  const aiPick = aiRow[p.productTypeCode] ?? null;
                  const brokerPick = overrides[p.productTypeCode];
                  const effective = brokerPick ?? aiPick;
                  return (
                    <td key={p.productTypeCode}>
                      <select
                        className="input"
                        value={effective ?? ''}
                        onChange={(e) => {
                          const next = e.target.value || null;
                          const nextMap = {
                            ...overrides,
                            [p.productTypeCode]: next,
                          };
                          onChange(g.suggestedName, { defaultPlanByProduct: nextMap });
                        }}
                        style={{ minWidth: '7rem' }}
                      >
                        <option value="">— pick a plan —</option>
                        {p.plans.map((pl) => (
                          <option key={pl.rawCode} value={pl.rawCode}>
                            {pl.code} · {pl.name.slice(0, 40)}
                          </option>
                        ))}
                        <option value={INELIGIBLE}>Ineligible</option>
                      </select>
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
// exotic.
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
