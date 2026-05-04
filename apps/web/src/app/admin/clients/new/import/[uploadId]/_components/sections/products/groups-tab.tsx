'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readBrokerOverride, suggestionsFromDraft } from '../_types';
import type { WizardExtractedProduct } from '../_types';
import {
  type DerivedCategory,
  type EligibilityOverride,
  type GroupOverride,
  INELIGIBLE,
  buildProductAssignments,
  deriveEmployeeCategories,
  renderPredicate,
} from '../eligibility-helpers';

// ── GroupCard ─────────────────────────────────────────────────

function GroupCard({
  category,
  override,
  product,
  productAssignments,
  expanded,
  onToggleExpand,
  onChange,
}: {
  category: DerivedCategory;
  override: GroupOverride;
  product: WizardExtractedProduct;
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

  const pa = productAssignments[0];
  const row = pa?.assignments.find((a) => a.categoryKey === category.key);
  const aiPlan = row?.aiSuggestedPlan ?? null;
  const brokerPlan = row?.brokerOverridePlan ?? null;
  const effectivePlan = row?.effectivePlan ?? null;

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
                merged from {category.sourceSuggestions.length}
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

          {isIncluded ? (
            <div
              className="mt-2"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: '0.25rem 0.75rem',
                alignItems: 'center',
                fontSize: 'var(--font-sm)',
              }}
            >
              <code className="text-mono-xs">{product.productTypeCode}</code>
              <select
                className="input"
                value={effectivePlan ?? ''}
                onChange={(e) => {
                  const current = override.defaultPlanByProduct ?? {};
                  onChange({
                    defaultPlanByProduct: {
                      ...current,
                      [product.productTypeCode]: e.target.value || null,
                    },
                  });
                }}
                style={{ fontSize: 'var(--font-sm)', padding: '0.15rem 0.25rem' }}
                aria-label={`Plan for ${product.productTypeCode}`}
              >
                <option value="">— not assigned —</option>
                {product.plans.map((pl) => (
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
            </div>
          ) : null}

          {expanded ? (
            <div style={{ marginTop: '0.75rem' }}>
              <input
                className="input mb-2"
                type="text"
                value={override.description ?? category.description}
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
                    setPredicateText(JSON.stringify(category.predicate, null, 2));
                    onChange({ predicate: null });
                    setPredicateError(null);
                  }}
                >
                  Reset to AI
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
    </Card>
  );
}

// ── GroupsTab ─────────────────────────────────────────────────

export function GroupsTab({
  product,
  draft,
}: {
  product: WizardExtractedProduct;
  draft: { id: string; progress: unknown; employeeCategories?: string[] };
}) {
  const suggestions = useMemo(() => suggestionsFromDraft(draft.progress), [draft.progress]);
  const baseCategories = useMemo(
    () => deriveEmployeeCategories(suggestions, draft.employeeCategories),
    [suggestions, draft.employeeCategories],
  );

  const [override, setOverride] = useState<EligibilityOverride>(() => {
    const persisted = readBrokerOverride<EligibilityOverride>(draft.progress, 'eligibility', {
      groups: {},
    });
    const groups = persisted.groups && typeof persisted.groups === 'object' ? persisted.groups : {};
    if (Object.keys(groups).length > 0) return { groups: { ...groups } };
    const init: Record<string, GroupOverride> = {};
    for (const c of baseCategories) {
      init[c.key] = { included: true };
    }
    return { groups: init };
  });

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  const markAutosaveDirty = useDebouncedAutosave(
    override,
    (value) => saveOverride.mutate({ draftId: draft.id, namespace: 'eligibility', value }),
    { delayMs: 600 },
  );

  const updateGroup = useCallback(
    (key: string, patch: Partial<GroupOverride>) => {
      markAutosaveDirty();
      setOverride((prev) => ({
        groups: {
          ...prev.groups,
          [key]: { ...(prev.groups[key] ?? { included: false }), ...patch },
        },
      }));
    },
    [markAutosaveDirty],
  );

  const allCategories = useMemo(() => {
    const derivedKeys = new Set(baseCategories.map((c) => c.key));
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
    return [...baseCategories, ...custom];
  }, [baseCategories, override.groups]);

  const productAssignments = useMemo(
    () => buildProductAssignments([product], allCategories, suggestions, override.groups),
    [product, allCategories, suggestions, override.groups],
  );

  const addCategory = () => {
    const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
    markAutosaveDirty();
    setOverride((prev) => ({
      groups: { ...prev.groups, [key]: { included: true, rename: 'New group' } },
    }));
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-1">Benefit groups</h3>
        <p className="field-help mb-3">
          Each group is an employee population. The plan column below is scoped to{' '}
          <strong>{product.productTypeCode}</strong>. Configure other products by switching the
          product tab above.
        </p>

        {allCategories.length === 0 ? (
          <p className="field-help mb-0">
            No benefit groups suggested yet — AI extraction hasn&apos;t run or found no recognisable
            eligibility tokens.
          </p>
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            {allCategories.map((c) => (
              <GroupCard
                key={c.key}
                category={c}
                override={override.groups[c.key] ?? { included: true }}
                product={product}
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

        {saveOverride.isPending ? (
          <p className="field-help text-muted" style={{ textAlign: 'right' }}>
            Saving…
          </p>
        ) : saveOverride.isSuccess ? (
          <p className="field-help text-good" style={{ textAlign: 'right' }}>
            ✓ Saved
          </p>
        ) : null}
      </Card>
    </section>
  );
}
