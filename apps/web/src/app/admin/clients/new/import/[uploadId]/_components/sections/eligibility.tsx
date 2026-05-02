'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  buildProductAssignments,
  deriveEmployeeCategories,
  renderPredicate,
} from './eligibility-helpers';

type Props = {
  draft: { id: string; extractedProducts: unknown; progress: unknown };
  markSectionDirty?: (id: string) => void;
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

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

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

  const addCategory = () => {
    const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
    markDirty();
    setOverride((prev) => ({
      groups: {
        ...prev.groups,
        [key]: { included: true, rename: 'New group' },
      },
    }));
  };

  return (
    <>
      <h2>Benefit Groups</h2>
      <p className="field-help mb-4">
        Each group represents an employee population with shared eligibility rules. Plan assignments
        show which plan each group gets per product.
      </p>

      {allCategories.length === 0 ? (
        <Card className="card-padded">
          <p className="field-help mb-0">
            No benefit groups suggested yet. The slip&rsquo;s categories had no recognisable
            eligibility tokens, or the AI extraction hasn&rsquo;t run.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          {allCategories.map((c) => (
            <BenefitGroupCard
              key={c.key}
              category={c}
              override={override.groups[c.key] ?? { included: c.tokenMatches > 0 }}
              products={products}
              productAssignments={productAssignments}
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
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={addCategory}>
        + Add group
      </button>
    </>
  );
}

function BenefitGroupCard({
  category,
  override,
  products,
  productAssignments,
  expanded,
  onToggleExpand,
  onChange,
}: {
  category: DerivedCategory;
  override: GroupOverride;
  products: WizardExtractedProduct[];
  productAssignments: ReturnType<typeof buildProductAssignments>;
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
  const activePredicate = override.predicate ?? category.predicate;
  const isIncluded = override.included;

  const plansByProduct = useMemo(() => {
    const result: Array<{
      productTypeCode: string;
      insurerCode: string;
      plans: WizardExtractedProduct['plans'];
      aiPlan: string | null;
      brokerPlan: string | null;
      effectivePlan: string | null;
    }> = [];
    for (const pa of productAssignments) {
      const row = pa.assignments.find((a) => a.categoryKey === category.key);
      if (!row) continue;
      result.push({
        productTypeCode: pa.productTypeCode,
        insurerCode: pa.insurerCode,
        plans: pa.plans,
        aiPlan: row.aiSuggestedPlan,
        brokerPlan: row.brokerOverridePlan,
        effectivePlan: row.effectivePlan,
      });
    }
    return result;
  }, [productAssignments, category.key]);

  return (
    <Card className="card-padded" style={{ opacity: isIncluded ? 1 : 0.5 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
        <input
          type="checkbox"
          checked={isIncluded}
          onChange={(e) => onChange({ included: e.target.checked })}
          aria-label={`Include ${displayName}`}
          style={{ marginTop: '0.25rem' }}
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleExpand}>
              {expanded ? 'Collapse' : 'Edit'}
            </button>
          </div>

          <div className="row mt-1" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
              Predicate:
            </span>
            <code className="text-mono-xs">{renderPredicate(activePredicate)}</code>
          </div>

          {isIncluded && products.length > 0 ? (
            <div className="mt-2">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: '0.25rem 0.75rem',
                  alignItems: 'center',
                  fontSize: 'var(--font-sm)',
                }}
              >
                {plansByProduct.map((p) => (
                  <PlanAssignmentRow
                    key={`${p.productTypeCode}-${p.insurerCode}`}
                    productTypeCode={p.productTypeCode}
                    plans={p.plans}
                    effectivePlan={p.effectivePlan}
                    aiPlan={p.aiPlan}
                    brokerPlan={p.brokerPlan}
                    onChangePlan={(planRawCode) => {
                      const current = override.defaultPlanByProduct ?? {};
                      onChange({
                        defaultPlanByProduct: {
                          ...current,
                          [p.productTypeCode]: planRawCode,
                        },
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {expanded ? (
            <ExpandedEditor
              category={category}
              override={override}
              predicateText={predicateText}
              predicateError={predicateError}
              onPredicateTextChange={setPredicateText}
              onPredicateErrorChange={setPredicateError}
              onChange={onChange}
            />
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function PlanAssignmentRow({
  productTypeCode,
  plans,
  effectivePlan,
  aiPlan,
  brokerPlan,
  onChangePlan,
}: {
  productTypeCode: string;
  plans: WizardExtractedProduct['plans'];
  effectivePlan: string | null;
  aiPlan: string | null;
  brokerPlan: string | null;
  onChangePlan: (planRawCode: string | null) => void;
}) {
  return (
    <>
      <code className="text-mono-xs">{productTypeCode}</code>
      <select
        className="input"
        value={effectivePlan ?? ''}
        onChange={(e) => onChangePlan(e.target.value || null)}
        style={{ fontSize: 'var(--font-sm)', padding: '0.15rem 0.25rem' }}
        aria-label={`Plan for ${productTypeCode}`}
      >
        <option value="">— not assigned —</option>
        {plans.map((pl) => (
          <option key={pl.rawCode} value={pl.rawCode}>
            {pl.code} · {pl.name.slice(0, 40)}
          </option>
        ))}
        <option value={INELIGIBLE}>Ineligible</option>
      </select>
      <span style={{ fontSize: 'var(--font-sm)' }}>
        {aiPlan && !brokerPlan ? (
          <span className="text-muted">AI</span>
        ) : brokerPlan ? (
          <span style={{ color: 'var(--accent)' }}>edited</span>
        ) : null}
      </span>
    </>
  );
}

function ExpandedEditor({
  category,
  override,
  predicateText,
  predicateError,
  onPredicateTextChange,
  onPredicateErrorChange,
  onChange,
}: {
  category: DerivedCategory;
  override: GroupOverride;
  predicateText: string;
  predicateError: string | null;
  onPredicateTextChange: (text: string) => void;
  onPredicateErrorChange: (error: string | null) => void;
  onChange: (patch: Partial<GroupOverride>) => void;
}) {
  const displayDescription = override.description ?? category.description;

  return (
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
        onChange={(e) => onPredicateTextChange(e.target.value)}
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
                onPredicateErrorChange('Predicate must be a JSON object.');
                return;
              }
              onPredicateErrorChange(null);
              onChange({ predicate: parsed as Record<string, unknown> });
            } catch (err) {
              onPredicateErrorChange(
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
            onPredicateTextChange(JSON.stringify(category.predicate, null, 2));
            onChange({ predicate: null });
            onPredicateErrorChange(null);
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
  );
}
