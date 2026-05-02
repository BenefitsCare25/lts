'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionId } from './_registry';
import {
  type WizardExtractedProduct,
  type WizardPlanField,
  type WizardPremiumRateField,
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
  markSectionDirty?: (id: SectionId) => void;
};

type Tab = 'details' | 'plans' | 'rates' | 'groups' | 'endorsements';

// Empty product factory used by "+ Add product" — every field is the
// minimal valid envelope so downstream Apply doesn't trip on null
// checks. The broker fills in via the editable fields immediately.
const emptyProduct = (productTypeCode = 'GTL', insurerCode = ''): WizardExtractedProduct => ({
  productTypeCode,
  insurerCode,
  header: {
    policyNumber: { value: null, confidence: 0 },
    period: { value: null, confidence: 0 },
    lastEntryAge: { value: null, confidence: 0 },
    administrationType: { value: null, confidence: 0 },
    currency: { value: 'SGD', confidence: 0.3 },
  },
  policyholder: {
    legalName: { value: null, confidence: 0 },
    uen: { value: null, confidence: 0 },
    address: { value: null, confidence: 0 },
    businessDescription: { value: null, confidence: 0 },
    insuredEntities: [],
  },
  eligibility: {
    freeText: { value: null, confidence: 0 },
    categories: [],
  },
  plans: [],
  premiumRates: [],
  benefits: [],
  extractionMeta: {
    overallConfidence: 0.5,
    extractorVersion: 'broker-manual',
    warnings: [],
  },
});

const COVER_BASIS_OPTIONS: WizardPlanField['coverBasis'][] = [
  'per_cover_tier',
  'salary_multiple',
  'fixed_amount',
  'per_region',
  'earnings_based',
  'per_employee_flat',
];

const COVER_BASIS_LABELS: Record<WizardPlanField['coverBasis'], string> = {
  per_cover_tier: 'Per cover tier',
  salary_multiple: 'Salary multiple',
  fixed_amount: 'Fixed amount',
  per_region: 'Per region',
  earnings_based: 'Earnings based',
  per_employee_flat: 'Per employee (flat)',
};

const COMMON_COVER_TIERS = ['EO', 'EF', 'E1C', 'E2C', 'E3C', 'E4C'];

export function ProductsSection({ draft, markSectionDirty }: Props) {
  // Local mirror of the products list. Re-seeded only when draft.id
  // changes; subsequent refetches don't clobber in-flight edits.
  const [products, setProducts] = useState<WizardExtractedProduct[]>(() =>
    extractedProductsFromDraft(draft.extractedProducts),
  );
  const seededDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededDraftIdRef.current === draft.id) return;
    seededDraftIdRef.current = draft.id;
    setProducts(extractedProductsFromDraft(draft.extractedProducts));
  }, [draft.id, draft.extractedProducts]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const active = products[activeIndex] ?? null;

  const saveProducts = trpc.extractionDrafts.updateExtractedProducts.useMutation();
  const markAutosaveDirty = useDebouncedAutosave(
    products,
    (value) =>
      saveProducts.mutate({
        draftId: draft.id,
        extractedProducts: value as unknown as Array<{
          productTypeCode: string;
          insurerCode: string;
        }>,
      }),
    { delayMs: 700 },
  );

  const markProductsDirty = useCallback(() => {
    markAutosaveDirty();
    markSectionDirty?.('products');
  }, [markAutosaveDirty, markSectionDirty]);

  const updateProduct = useCallback(
    (index: number, patch: (p: WizardExtractedProduct) => WizardExtractedProduct) => {
      markProductsDirty();
      setProducts((prev) => prev.map((p, i) => (i === index ? patch(p) : p)));
    },
    [markProductsDirty],
  );

  const addProduct = () => {
    markProductsDirty();
    setProducts((prev) => {
      setActiveIndex(prev.length);
      return [...prev, emptyProduct()];
    });
    setActiveTab('details');
  };

  const removeProduct = (index: number) => {
    if (
      !window.confirm(
        `Remove product "${products[index]?.productTypeCode}·${products[index]?.insurerCode}" from the draft?`,
      )
    ) {
      return;
    }
    markProductsDirty();
    setProducts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (activeIndex >= next.length) setActiveIndex(Math.max(0, next.length - 1));
      return next;
    });
  };

  if (products.length === 0) {
    return (
      <>
        <h2>Products</h2>
        <section className="section">
          <Card className="card-padded">
            <p className="mb-2">
              <strong>No products in the catalogue yet.</strong>
            </p>
            <p className="field-help mb-3">
              The slip-level details (client, entities, benefit year, insurers) are populated, but
              every per-product extraction pass failed or no template matched. Re-run AI extraction
              from the Source section to retry, or add a product manually below.
            </p>
            <button type="button" className="btn btn-primary" onClick={addProduct}>
              + Add product manually
            </button>
          </Card>
        </section>
      </>
    );
  }

  return (
    <>
      <h2>Products ({products.length})</h2>

      <section className="section">
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {products.map((p, i) => (
            <button
              key={`${p.productTypeCode}-${p.insurerCode}-${i}`}
              type="button"
              className={i === activeIndex ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => {
                setActiveIndex(i);
                setActiveTab('details');
              }}
            >
              <code>{p.productTypeCode}</code> · {p.insurerCode || <em>—</em>}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addProduct}>
            + Add product
          </button>
        </div>
      </section>

      {active ? (
        <>
          <section className="section">
            <div className="row" style={{ borderBottom: '1px solid var(--border)' }}>
              <TabButton id="details" label="Details" active={activeTab} onChange={setActiveTab} />
              <TabButton
                id="plans"
                label={`Plans (${active.plans.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="rates"
                label={`Rates (${active.premiumRates.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="groups"
                label={`Groups (${suggestionsFromDraft(draft.progress).benefitGroups.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="endorsements"
                label="Endorsements"
                active={activeTab}
                onChange={setActiveTab}
              />
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                style={{ marginBottom: '0.25rem' }}
                onClick={() => removeProduct(activeIndex)}
              >
                Remove product
              </button>
            </div>
          </section>

          {activeTab === 'details' ? (
            <DetailsTab product={active} onChange={(patch) => updateProduct(activeIndex, patch)} />
          ) : null}
          {activeTab === 'plans' ? (
            <PlansTab product={active} onChange={(patch) => updateProduct(activeIndex, patch)} />
          ) : null}
          {activeTab === 'rates' ? (
            <RatesTab product={active} onChange={(patch) => updateProduct(activeIndex, patch)} />
          ) : null}
          {activeTab === 'groups' ? <GroupsTab product={active} draft={draft} /> : null}
          {activeTab === 'endorsements' ? (
            <EndorsementsTab
              product={active}
              onChange={(patch) => updateProduct(activeIndex, patch)}
            />
          ) : null}

          {saveProducts.isPending ? (
            <p className="field-help text-muted" style={{ textAlign: 'right' }}>
              Saving…
            </p>
          ) : saveProducts.isSuccess ? (
            <p className="field-help text-good" style={{ textAlign: 'right' }}>
              ✓ Saved
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function TabButton({
  id,
  label,
  active,
  onChange,
}: {
  id: Tab;
  label: string;
  active: Tab;
  onChange: (id: Tab) => void;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      style={{
        padding: '0.5rem 1rem',
        background: 'none',
        border: 'none',
        borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 400,
        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  );
}

// ── Details tab ──────────────────────────────────────────────

type ProductPatcher = (patch: (p: WizardExtractedProduct) => WizardExtractedProduct) => void;

function DetailsTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  // Helper that updates a single header field, preserving its
  // confidence + sourceRef so the badge / hover keep working but the
  // value reflects the broker's edit.
  const setHeader = <K extends keyof WizardExtractedProduct['header']>(
    key: K,
    value: WizardExtractedProduct['header'][K]['value'],
  ) => {
    onChange((p) => ({
      ...p,
      header: {
        ...p.header,
        [key]: {
          ...p.header[key],
          value,
          // Broker edits become high-confidence — preserves the AI's
          // sourceRef but signals the value is no longer model-derived.
          confidence: 1,
        } as WizardExtractedProduct['header'][K],
      },
    }));
  };

  const setEligibilityText = (value: string | null) => {
    onChange((p) => ({
      ...p,
      eligibility: {
        ...p.eligibility,
        freeText: { ...p.eligibility.freeText, value, confidence: 1 },
      },
    }));
  };

  const setProductTypeCode = (value: string) => {
    onChange((p) => ({ ...p, productTypeCode: value.trim().toUpperCase() }));
  };
  const setInsurerCode = (value: string) => {
    onChange((p) => ({ ...p, insurerCode: value.trim().toUpperCase() }));
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Product details</h3>
        <div className="form-grid">
          <EditableFieldRow
            label="Product type"
            value={product.productTypeCode}
            onChange={setProductTypeCode}
            confidence={1}
          />
          <EditableFieldRow
            label="Insurer"
            value={product.insurerCode}
            onChange={setInsurerCode}
            confidence={1}
          />
          <EditableFieldRow
            label="Policy number"
            value={product.header.policyNumber.value ?? ''}
            onChange={(v) => setHeader('policyNumber', v.trim() || null)}
            confidence={product.header.policyNumber.confidence}
            sourceRef={product.header.policyNumber.sourceRef}
            placeholder="(unassigned — broker fills before apply)"
          />
          <EditableFieldRow
            label="Period start"
            value={product.header.period.value?.from ?? ''}
            onChange={(v) =>
              setHeader('period', {
                from: v.trim(),
                to: product.header.period.value?.to ?? '',
              })
            }
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
            inputType="date"
          />
          <EditableFieldRow
            label="Period end"
            value={product.header.period.value?.to ?? ''}
            onChange={(v) =>
              setHeader('period', {
                from: product.header.period.value?.from ?? '',
                to: v.trim(),
              })
            }
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
            inputType="date"
          />
          <EditableFieldRow
            label="Last entry age"
            value={product.header.lastEntryAge.value?.toString() ?? ''}
            onChange={(v) => {
              const n = Number.parseInt(v, 10);
              setHeader('lastEntryAge', Number.isFinite(n) ? n : null);
            }}
            confidence={product.header.lastEntryAge.confidence}
            sourceRef={product.header.lastEntryAge.sourceRef}
            inputType="number"
          />
          <EditableFieldRow
            label="Administration"
            value={product.header.administrationType.value ?? ''}
            onChange={(v) => setHeader('administrationType', v.trim() || null)}
            confidence={product.header.administrationType.confidence}
            sourceRef={product.header.administrationType.sourceRef}
            placeholder="e.g. Headcount basis, Named basis"
          />
          <EditableFieldRow
            label="Currency"
            value={product.header.currency.value ?? ''}
            onChange={(v) => setHeader('currency', v.trim().toUpperCase() || null)}
            confidence={product.header.currency.confidence}
            sourceRef={product.header.currency.sourceRef}
            placeholder="SGD"
          />
        </div>

        <h3 className="mt-4 mb-3">Eligibility</h3>
        <EditableFieldRow
          label="Eligibility text"
          value={product.eligibility.freeText.value ?? ''}
          onChange={(v) => setEligibilityText(v.trim() || null)}
          confidence={product.eligibility.freeText.confidence}
          sourceRef={product.eligibility.freeText.sourceRef}
          multiline
        />
      </Card>
    </section>
  );
}

// ── Plans tab ────────────────────────────────────────────────

function PlansTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  const updatePlan = (idx: number, patch: Partial<WizardPlanField>) => {
    onChange((p) => ({
      ...p,
      plans: p.plans.map((pl, i) => (i === idx ? { ...pl, ...patch, confidence: 1 } : pl)),
    }));
  };
  const addPlan = () => {
    onChange((p) => ({
      ...p,
      plans: [
        ...p.plans,
        {
          rawCode: '',
          rawName: '',
          code: `PLAN${p.plans.length + 1}`,
          name: '',
          coverBasis: 'fixed_amount',
          stacksOnRawCode: null,
          selectionMode: 'broker_default',
          schedule: {},
          confidence: 1,
        },
      ],
    }));
  };
  const removePlan = (idx: number) => {
    onChange((p) => ({ ...p, plans: p.plans.filter((_, i) => i !== idx) }));
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Plans on this product</h3>
        {product.plans.length === 0 ? (
          <p className="field-help mb-3">No plans yet. Add one below.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Cover basis</th>
                  <th>Schedule</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {product.plans.map((plan, idx) => (
                  <tr key={`plan-${idx}-${plan.code}`}>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={plan.code}
                        onChange={(e) => updatePlan(idx, { code: e.target.value.toUpperCase() })}
                        style={{ width: '8rem' }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={plan.name}
                        onChange={(e) => updatePlan(idx, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={plan.coverBasis}
                        onChange={(e) =>
                          updatePlan(idx, {
                            coverBasis: e.target.value as WizardPlanField['coverBasis'],
                          })
                        }
                      >
                        {COVER_BASIS_OPTIONS.map((cb) => (
                          <option key={cb} value={cb}>
                            {COVER_BASIS_LABELS[cb]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <ScheduleEditor
                        schedule={plan.schedule}
                        coverBasis={plan.coverBasis}
                        onChange={(schedule) => updatePlan(idx, { schedule })}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ alignItems: 'center', gap: '0.25rem' }}>
                        <ConfidenceBadge confidence={plan.confidence} variant="dot" />
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removePlan(idx)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row mt-3">
          <button type="button" className="btn btn-ghost" onClick={addPlan}>
            + Add plan
          </button>
        </div>
      </Card>
    </section>
  );
}

function ScheduleEditor({
  schedule,
  coverBasis,
  onChange,
}: {
  schedule: Record<string, unknown>;
  coverBasis: WizardPlanField['coverBasis'];
  onChange: (next: Record<string, unknown>) => void;
}) {
  // Two key inputs depending on cover basis. Brokers can also fall back
  // to dailyRoomBoard for medical plans (always shown).
  const setKey = (key: string, value: number | null) => {
    const next = { ...schedule };
    if (value == null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: '0.25rem' }}>
      {coverBasis === 'salary_multiple' ? (
        <NumberInput
          label="× salary"
          value={typeof schedule.multiplier === 'number' ? schedule.multiplier : null}
          onChange={(v) => setKey('multiplier', v)}
          step={0.1}
          width="5rem"
        />
      ) : null}
      {coverBasis === 'fixed_amount' ? (
        <NumberInput
          label="Sum"
          value={typeof schedule.sumAssured === 'number' ? schedule.sumAssured : null}
          onChange={(v) => setKey('sumAssured', v)}
          width="8rem"
        />
      ) : null}
      {coverBasis === 'per_cover_tier' || typeof schedule.dailyRoomBoard === 'number' ? (
        <NumberInput
          label="R&B"
          value={typeof schedule.dailyRoomBoard === 'number' ? schedule.dailyRoomBoard : null}
          onChange={(v) => setKey('dailyRoomBoard', v)}
          width="6rem"
        />
      ) : null}
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step,
  width,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  step?: number;
  width?: string;
}) {
  return (
    <label
      className="row"
      style={{ alignItems: 'center', gap: '0.25rem', fontSize: 'var(--font-sm)' }}
    >
      <span className="text-muted">{label}</span>
      <input
        className="input"
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n : null);
        }}
        style={{ width: width ?? '5rem' }}
      />
    </label>
  );
}

// ── Groups tab ───────────────────────────────────────────────

function GroupsTab({
  product,
  draft,
}: {
  product: WizardExtractedProduct;
  draft: { id: string; progress: unknown };
}) {
  const suggestions = useMemo(() => suggestionsFromDraft(draft.progress), [draft.progress]);
  const baseCategories = useMemo(() => deriveEmployeeCategories(suggestions), [suggestions]);

  const [override, setOverride] = useState<EligibilityOverride>(() => {
    const persisted = readBrokerOverride<EligibilityOverride>(draft.progress, 'eligibility', {
      groups: {},
    });
    const groups = persisted.groups && typeof persisted.groups === 'object' ? persisted.groups : {};
    if (Object.keys(groups).length > 0) return { groups: { ...groups } };
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
                override={override.groups[c.key] ?? { included: c.tokenMatches > 0 }}
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

// ── Rates tab ────────────────────────────────────────────────

function RatesTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  const bundledWith = (product.header as Record<string, unknown>).bundledWithProductCode as
    | string
    | undefined;

  const updateRate = (idx: number, patch: Partial<WizardPremiumRateField>) => {
    onChange((p) => ({
      ...p,
      premiumRates: p.premiumRates.map((r, i) =>
        i === idx ? { ...r, ...patch, confidence: 1 } : r,
      ),
    }));
  };
  const addRate = (planRawCode: string) => {
    onChange((p) => ({
      ...p,
      premiumRates: [
        ...p.premiumRates,
        {
          planRawCode,
          coverTier: null,
          ratePerThousand: null,
          fixedAmount: null,
          blockLabel: null,
          ageBand: null,
          confidence: 1,
        },
      ],
    }));
  };
  const removeRate = (idx: number) => {
    onChange((p) => ({ ...p, premiumRates: p.premiumRates.filter((_, i) => i !== idx) }));
  };

  if (bundledWith) {
    return (
      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Premium rates</h3>
          <p className="field-help mb-0">
            <strong>Bundled with {bundledWith}.</strong> The slip indicates this product&rsquo;s
            premium is rolled into the {bundledWith} product&rsquo;s rates. No separate rate rows
            are expected here.
          </p>
        </Card>
      </section>
    );
  }

  // Group displayed rates by plan; preserve original index for edits.
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ rate: WizardPremiumRateField; idx: number }>>();
    product.premiumRates.forEach((r, i) => {
      const key = r.planRawCode;
      const list = map.get(key) ?? [];
      list.push({ rate: r, idx: i });
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [product.premiumRates]);

  const planOptions = product.plans
    .filter((p) => p.rawCode)
    .map((p) => ({ rawCode: p.rawCode, label: `${p.code} · ${p.name.slice(0, 40)}` }));

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Premium rates</h3>
        {product.premiumRates.length === 0 ? (
          <p className="field-help mb-3">
            No rates yet. Add one per plan below — pick a plan, then enter rate / fixed amount.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Tier</th>
                  <th>Block</th>
                  <th>Age</th>
                  <th>Rate / 1,000</th>
                  <th>Fixed amount</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap(([planRawCode, rows]) =>
                  rows.map(({ rate, idx }, j) => (
                    <tr key={`${planRawCode}-${idx}`}>
                      {j === 0 ? (
                        <td rowSpan={rows.length}>
                          <select
                            className="input"
                            value={planRawCode}
                            onChange={(e) => {
                              const next = e.target.value;
                              for (const row of rows) {
                                updateRate(row.idx, { planRawCode: next });
                              }
                            }}
                          >
                            <option value={planRawCode}>{planRawCode || '—'}</option>
                            {planOptions
                              .filter((p) => p.rawCode !== planRawCode)
                              .map((p) => (
                                <option key={p.rawCode} value={p.rawCode}>
                                  {p.label}
                                </option>
                              ))}
                          </select>
                        </td>
                      ) : null}
                      <td>
                        <select
                          className="input"
                          value={rate.coverTier ?? ''}
                          onChange={(e) => updateRate(idx, { coverTier: e.target.value || null })}
                          style={{ width: '5rem' }}
                        >
                          <option value="">—</option>
                          {COMMON_COVER_TIERS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="text"
                          value={rate.blockLabel ?? ''}
                          onChange={(e) => updateRate(idx, { blockLabel: e.target.value || null })}
                          style={{ width: '7rem' }}
                          placeholder="(all)"
                        />
                      </td>
                      <td>
                        <div className="row" style={{ gap: '0.15rem', alignItems: 'center' }}>
                          <input
                            className="input"
                            type="number"
                            value={rate.ageBand?.from ?? ''}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              updateRate(idx, {
                                ageBand: Number.isFinite(n)
                                  ? { from: n, to: rate.ageBand?.to ?? n }
                                  : null,
                              });
                            }}
                            style={{ width: '3.5rem' }}
                            placeholder="from"
                          />
                          <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
                            –
                          </span>
                          <input
                            className="input"
                            type="number"
                            value={rate.ageBand?.to ?? ''}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              updateRate(idx, {
                                ageBand:
                                  rate.ageBand != null
                                    ? {
                                        ...rate.ageBand,
                                        to: Number.isFinite(n) ? n : rate.ageBand.from,
                                      }
                                    : null,
                              });
                            }}
                            style={{ width: '3.5rem' }}
                            placeholder="to"
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          step={0.01}
                          value={rate.ratePerThousand ?? ''}
                          onChange={(e) => {
                            const n = Number.parseFloat(e.target.value);
                            updateRate(idx, {
                              ratePerThousand: Number.isFinite(n) ? n : null,
                            });
                          }}
                          style={{ width: '6rem' }}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          step={0.01}
                          value={rate.fixedAmount ?? ''}
                          onChange={(e) => {
                            const n = Number.parseFloat(e.target.value);
                            updateRate(idx, { fixedAmount: Number.isFinite(n) ? n : null });
                          }}
                          style={{ width: '7rem' }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeRate(idx)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="row mt-3" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          {planOptions.length === 0 ? (
            <p className="field-help mb-0">Add at least one plan first to attach rates.</p>
          ) : (
            planOptions.map((p) => (
              <button
                key={p.rawCode}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addRate(p.rawCode)}
              >
                + Add rate for <code>{p.rawCode}</code>
              </button>
            ))
          )}
        </div>
      </Card>
    </section>
  );
}

// ── Endorsements tab ─────────────────────────────────────────

function EndorsementsTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  const updatePlanSchedule = (idx: number, patch: Record<string, unknown>) => {
    onChange((p) => ({
      ...p,
      plans: p.plans.map((pl, i) =>
        i === idx ? { ...pl, schedule: { ...pl.schedule, ...patch }, confidence: 1 } : pl,
      ),
    }));
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Endorsements &amp; exclusions</h3>
        <p className="field-help mb-3">
          Per-plan endorsement and exclusion codes. Today these are free-text comma-separated lists;
          once the EndorsementCatalogue / ExclusionCatalogue admin lands, this becomes a
          multi-select against the registered codes.
        </p>
        {product.plans.length === 0 ? (
          <p className="field-help mb-0">No plans defined — add plans first.</p>
        ) : (
          <ul className="issue-list">
            {product.plans.map((plan, idx) => {
              const endorsements = (plan.schedule.endorsements as unknown[] | undefined) ?? [];
              const exclusions = (plan.schedule.exclusions as unknown[] | undefined) ?? [];
              return (
                <li key={`${plan.code}-${idx}`}>
                  <strong>
                    <code>{plan.code}</code> — {plan.name}
                  </strong>
                  <div
                    className="form-grid"
                    style={{ marginTop: '0.5rem', gridTemplateColumns: '1fr 1fr' }}
                  >
                    <div className="field">
                      <label
                        className="field-label"
                        htmlFor={`endorsements-${idx}`}
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        Endorsements
                      </label>
                      <input
                        id={`endorsements-${idx}`}
                        className="input"
                        type="text"
                        value={endorsements.map(String).join(', ')}
                        onChange={(e) => {
                          const parts = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          updatePlanSchedule(idx, { endorsements: parts });
                        }}
                        placeholder="e.g. ER_OUTPATIENT_CANCER, ER_KIDNEY_DIALYSIS"
                      />
                    </div>
                    <div className="field">
                      <label
                        className="field-label"
                        htmlFor={`exclusions-${idx}`}
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        Exclusions
                      </label>
                      <input
                        id={`exclusions-${idx}`}
                        className="input"
                        type="text"
                        value={exclusions.map(String).join(', ')}
                        onChange={(e) => {
                          const parts = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          updatePlanSchedule(idx, { exclusions: parts });
                        }}
                        placeholder="e.g. EX_PRE_EXISTING, EX_INTERNATIONAL_TRANSFEREE"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

// ── Shared editable field row ────────────────────────────────

function EditableFieldRow({
  label,
  value,
  onChange,
  confidence,
  sourceRef,
  inputType,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string } | undefined;
  inputType?: 'text' | 'number' | 'date' | undefined;
  multiline?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  const id = `fr-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {sourceRef ? (
          <ConfidenceBadge confidence={confidence} variant="dot" sourceRef={sourceRef} />
        ) : (
          <ConfidenceBadge confidence={confidence} variant="dot" />
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="input"
          value={value}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={inputType ?? 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {sourceRef?.sheet ? (
        <span className="field-help">
          Source: {sourceRef.sheet}
          {sourceRef.cell ? `!${sourceRef.cell}` : ''}
        </span>
      ) : null}
    </div>
  );
}
