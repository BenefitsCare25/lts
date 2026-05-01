'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SectionId } from './_registry';
import {
  type WizardExtractedProduct,
  extractedProductsFromDraft,
  readBrokerOverride,
  suggestionsFromDraft,
} from './_types';
import {
  type DerivedCategory,
  type EligibilityOverride,
  type GroupOverride,
  INELIGIBLE,
  type ProductPlanMap,
  buildProductAssignments,
  categoryUsedByProducts,
  deriveEmployeeCategories,
  renderPredicate,
} from './eligibility-helpers';

type Props = {
  draft: { id: string; extractedProducts: unknown; progress: unknown };
  markSectionDirty?: (id: SectionId) => void;
};

export function EligibilitySection({ draft, markSectionDirty }: Props) {
  const products = extractedProductsFromDraft(draft.extractedProducts);
  const suggestions = suggestionsFromDraft(draft.progress);
  const categories = useMemo(() => deriveEmployeeCategories(suggestions), [suggestions]);

  const [override, setOverride] = useState<EligibilityOverride>(() => {
    const persisted = readBrokerOverride<EligibilityOverride>(draft.progress, 'eligibility', {
      groups: {},
    });
    const groups = persisted.groups && typeof persisted.groups === 'object' ? persisted.groups : {};
    if (Object.keys(groups).length > 0) {
      return { groups: { ...groups } };
    }
    const init: Record<string, GroupOverride> = {};
    for (const c of deriveEmployeeCategories(suggestionsFromDraft(draft.progress))) {
      init[c.key] = { included: c.tokenMatches > 0 };
    }
    return { groups: init };
  });

  const [activeProductIdx, setActiveProductIdx] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showMatrix, setShowMatrix] = useState(false);

  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  const markAutosaveDirty = useDebouncedAutosave(
    override,
    (value) =>
      saveOverride.mutate({
        draftId: draft.id,
        namespace: 'eligibility',
        value,
      }),
    { delayMs: 600 },
  );

  const markDirty = useCallback(() => {
    markAutosaveDirty();
    markSectionDirty?.('eligibility');
  }, [markAutosaveDirty, markSectionDirty]);

  const updateGroup = useCallback(
    (key: string, patch: Partial<GroupOverride>) => {
      markDirty();
      setOverride((prev) => ({
        groups: {
          ...prev.groups,
          [key]: { ...(prev.groups[key] ?? { included: false }), ...patch },
        },
      }));
    },
    [markDirty],
  );

  const allCategories = useMemo(() => {
    const derivedKeys = new Set(categories.map((c) => c.key));
    const custom: DerivedCategory[] = [];
    for (const [key, ov] of Object.entries(override.groups)) {
      if (!derivedKeys.has(key) && ov.included) {
        custom.push({
          key,
          displayName: ov.rename ?? key,
          description: ov.description ?? '',
          predicate: ov.predicate ?? {},
          tokenMatches: 0,
          sourceSuggestions: [],
        });
      }
    }
    return [...categories, ...custom];
  }, [categories, override.groups]);

  const productAssignments = useMemo(
    () => buildProductAssignments(products, allCategories, suggestions, override.groups),
    [products, allCategories, suggestions, override.groups],
  );

  const clampedProductIdx = activeProductIdx >= products.length ? 0 : activeProductIdx;

  const addCategory = () => {
    const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
    markDirty();
    setOverride((prev) => ({
      groups: {
        ...prev.groups,
        [key]: { included: true, rename: 'New category' },
      },
    }));
  };

  const includedCount = allCategories.filter(
    (c) => override.groups[c.key]?.included ?? c.tokenMatches > 0,
  ).length;

  return (
    <>
      <h2>Eligibility</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Employee categories ({allCategories.length})</h3>
          <p className="field-help mb-3">
            Each category represents a group of employees with shared eligibility rules. Categories
            are auto-merged from plan labels that share the same predicate.
          </p>
          {allCategories.length === 0 ? (
            <p className="field-help mb-0">
              No suggestions yet. Either the slip&rsquo;s plan labels had no recognisable
              eligibility tokens, or the AI extraction hasn&rsquo;t run.
            </p>
          ) : (
            <ul className="issue-list">
              {allCategories.map((c) => (
                <CategoryRow
                  key={c.key}
                  category={c}
                  override={override.groups[c.key] ?? { included: c.tokenMatches > 0 }}
                  suggestions={suggestions}
                  expanded={expandedKeys.has(c.key)}
                  onToggleExpand={() =>
                    setExpandedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      return next;
                    })
                  }
                  onChange={(patch) => updateGroup(c.key, patch)}
                />
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={addCategory}>
            + Add category
          </button>
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">
            Plan assignments by product ({includedCount} categories × {products.length} products)
          </h3>
          {products.length === 0 ? (
            <p className="field-help mb-0">No extracted products.</p>
          ) : includedCount === 0 ? (
            <p className="field-help mb-0">
              Tick at least one category above to see plan assignments.
            </p>
          ) : (
            <ProductAssignmentsCard
              products={products}
              productAssignments={productAssignments}
              activeIdx={clampedProductIdx}
              onChangeIdx={setActiveProductIdx}
              onChangePlan={(categoryKey, productTypeCode, planRawCode) => {
                const current = override.groups[categoryKey]?.defaultPlanByProduct ?? {};
                updateGroup(categoryKey, {
                  defaultPlanByProduct: {
                    ...current,
                    [productTypeCode]: planRawCode,
                  },
                });
              }}
            />
          )}
        </Card>
      </section>

      {productAssignments.length > 0 && includedCount > 0 ? (
        <section className="section">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowMatrix((v) => !v)}
          >
            {showMatrix ? 'Hide full matrix' : 'Show full matrix overview'}
          </button>
          {showMatrix ? (
            <Card className="card-padded mt-2">
              <FullMatrixSummary productAssignments={productAssignments} />
            </Card>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function CategoryRow({
  category,
  override,
  suggestions,
  expanded,
  onToggleExpand,
  onChange,
}: {
  category: DerivedCategory;
  override: GroupOverride;
  suggestions: ReturnType<typeof suggestionsFromDraft>;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<GroupOverride>) => void;
}) {
  const [predicateText, setPredicateText] = useState(() =>
    JSON.stringify(override.predicate ?? category.predicate, null, 2),
  );
  const [predicateError, setPredicateError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded) {
      setPredicateText(JSON.stringify(override.predicate ?? category.predicate, null, 2));
      setPredicateError(null);
    }
  }, [expanded, override.predicate, category.predicate]);

  const displayName = override.rename ?? category.displayName;
  const displayDescription = override.description ?? category.description;
  const activePredicate = override.predicate ?? category.predicate;
  const usedBy = useMemo(
    () => categoryUsedByProducts(category, suggestions),
    [category, suggestions],
  );

  return (
    <li className={category.tokenMatches === 0 ? 'issue is-warning' : 'issue is-info'}>
      <div className="row" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
        <input
          type="checkbox"
          checked={override.included}
          onChange={(e) => onChange({ included: e.target.checked })}
          aria-label={`Include ${displayName} category`}
        />
        <div style={{ flex: 1 }}>
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              className="input"
              type="text"
              value={displayName}
              onChange={(e) => onChange({ rename: e.target.value })}
              style={{ fontWeight: 600, flex: 1, minWidth: '12rem' }}
            />
            <ConfidenceBadge confidence={category.tokenMatches > 0 ? 0.85 : 0.3} variant="dot" />
            {category.sourceSuggestions.length > 1 ? (
              <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
                merged from {category.sourceSuggestions.length} labels
              </span>
            ) : null}
          </div>

          <div className="row mt-1" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <code className="text-mono-xs">{renderPredicate(activePredicate)}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleExpand}>
              {expanded ? 'Collapse' : 'Edit'}
            </button>
          </div>

          {usedBy.length > 0 ? (
            <div
              className="row mt-1"
              style={{
                gap: '0.25rem',
                flexWrap: 'wrap',
                fontSize: 'var(--font-sm)',
              }}
            >
              <span className="text-muted">Used by:</span>
              {usedBy.map((code) => (
                <code key={code} className="text-mono-xs">
                  {code}
                </code>
              ))}
            </div>
          ) : null}

          {expanded ? (
            <div style={{ marginTop: '0.75rem' }}>
              <input
                className="input mb-2"
                type="text"
                value={displayDescription}
                onChange={(e) => onChange({ description: e.target.value })}
                style={{ fontSize: 'var(--font-sm)' }}
                placeholder="Short broker-facing description"
              />

              {category.sourceSuggestions.length > 1 ? (
                <div className="field-help mb-2" style={{ fontSize: 'var(--font-sm)' }}>
                  Merged from:{' '}
                  {category.sourceSuggestions.map((s, i) => (
                    <span key={s}>
                      {i > 0 ? ', ' : ''}
                      <code>{s}</code>
                    </span>
                  ))}
                </div>
              ) : null}

              <textarea
                className="input"
                rows={5}
                value={predicateText}
                onChange={(e) => setPredicateText(e.target.value)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-sm)',
                }}
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
                      onChange({
                        predicate: parsed as Record<string, unknown>,
                      });
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
                    setPredicateText(JSON.stringify(category.predicate, null, 2));
                    onChange({ predicate: null });
                    setPredicateError(null);
                  }}
                >
                  Reset to AI suggestion
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => onChange({ included: false })}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ProductAssignmentsCard({
  products,
  productAssignments,
  activeIdx,
  onChangeIdx,
  onChangePlan,
}: {
  products: WizardExtractedProduct[];
  productAssignments: ProductPlanMap[];
  activeIdx: number;
  onChangeIdx: (idx: number) => void;
  onChangePlan: (categoryKey: string, productTypeCode: string, planRawCode: string | null) => void;
}) {
  const active = productAssignments[activeIdx] ?? productAssignments[0];
  if (!active) return null;

  return (
    <>
      <div className="row mb-3" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        {products.map((p, i) => {
          const pa = productAssignments[i];
          const assigned = pa?.assignments.filter((a) => a.effectivePlan != null).length;
          const total = pa?.assignments.length ?? 0;
          return (
            <button
              key={`${p.productTypeCode}-${p.insurerCode}`}
              type="button"
              className={i === activeIdx ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => onChangeIdx(i)}
            >
              <code>{p.productTypeCode}</code>
              <span className="text-muted" style={{ marginLeft: '0.25rem' }}>
                {assigned}/{total}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-2" style={{ fontSize: 'var(--font-sm)' }}>
        <strong>
          {active.productTypeCode} · {active.insurerCode}
        </strong>{' '}
        — {active.plans.length} plan{active.plans.length !== 1 ? 's' : ''}
      </div>

      {active.assignments.length === 0 ? (
        <p className="field-help mb-0">No included categories to assign.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee category</th>
                <th>Default plan</th>
                <th style={{ width: '3rem' }} aria-label="status" />
              </tr>
            </thead>
            <tbody>
              {active.assignments.map((a) => (
                <tr key={a.categoryKey}>
                  <td>
                    <strong>{a.categoryName}</strong>
                  </td>
                  <td>
                    <select
                      className="input"
                      value={a.effectivePlan ?? ''}
                      onChange={(e) =>
                        onChangePlan(a.categoryKey, active.productTypeCode, e.target.value || null)
                      }
                      style={{ minWidth: '10rem' }}
                      aria-label={`Default plan for ${a.categoryName} on ${active.productTypeCode}`}
                    >
                      <option value="">— not assigned —</option>
                      {active.plans.map((pl) => (
                        <option key={pl.rawCode} value={pl.rawCode}>
                          {pl.code} · {pl.name.slice(0, 40)}
                        </option>
                      ))}
                      <option value={INELIGIBLE}>Ineligible</option>
                    </select>
                  </td>
                  <td>
                    {a.aiSuggestedPlan && !a.brokerOverridePlan ? (
                      <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
                        AI
                      </span>
                    ) : a.brokerOverridePlan ? (
                      <span
                        style={{
                          fontSize: 'var(--font-sm)',
                          color: 'var(--accent)',
                        }}
                      >
                        edited
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FullMatrixSummary({
  productAssignments,
}: {
  productAssignments: ProductPlanMap[];
}) {
  if (productAssignments.length === 0) return null;
  const categoryKeys =
    productAssignments[0]?.assignments.map((a) => ({
      key: a.categoryKey,
      name: a.categoryName,
    })) ?? [];

  if (categoryKeys.length === 0) return null;

  return (
    <>
      <h3 className="mb-3">Full matrix overview</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              {productAssignments.map((p) => (
                <th key={`${p.productTypeCode}-${p.insurerCode}`}>
                  <code>{p.productTypeCode}</code>
                  <div className="field-help" style={{ fontSize: 'var(--font-sm)' }}>
                    {p.insurerCode}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoryKeys.map((cat) => (
              <tr key={cat.key}>
                <td>
                  <strong>{cat.name}</strong>
                </td>
                {productAssignments.map((p) => {
                  const row = p.assignments.find((a) => a.categoryKey === cat.key);
                  const plan = row?.effectivePlan;
                  const planObj = plan ? p.plans.find((pl) => pl.rawCode === plan) : null;
                  return (
                    <td key={`${p.productTypeCode}-${p.insurerCode}`}>
                      {plan === INELIGIBLE ? (
                        <span className="text-muted">Ineligible</span>
                      ) : planObj ? (
                        <code>{planObj.code}</code>
                      ) : plan ? (
                        <code>{plan}</code>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
