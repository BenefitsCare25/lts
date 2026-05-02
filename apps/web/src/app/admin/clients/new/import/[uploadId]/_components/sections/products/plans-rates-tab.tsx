'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { useMemo, useState } from 'react';
import {
  type WizardExtractedProduct,
  type WizardPlanField,
  type WizardPremiumRateField,
  readBrokerOverride,
  suggestionsFromDraft,
} from '../_types';
import {
  type EligibilityOverride,
  INELIGIBLE,
  buildProductAssignments,
  deriveEmployeeCategories,
} from '../eligibility-helpers';
import {
  COMMON_COVER_TIERS,
  COVER_BASIS_LABELS,
  COVER_BASIS_OPTIONS,
  type ProductPatcher,
} from './shared';

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

function ScheduleEditor({
  schedule,
  coverBasis,
  onChange,
}: {
  schedule: Record<string, unknown>;
  coverBasis: WizardPlanField['coverBasis'];
  onChange: (next: Record<string, unknown>) => void;
}) {
  const setKey = (key: string, value: number | null) => {
    const next = { ...schedule };
    if (value == null) delete next[key];
    else next[key] = value;
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

function PlanCard({
  plan,
  planIdx,
  planRates,
  assignedGroups,
  eligibilityCategories,
  onUpdatePlan,
  onRemovePlan,
  onAddRate,
  onUpdateRate,
  onRemoveRate,
}: {
  plan: WizardPlanField;
  planIdx: number;
  planRates: Array<{ rate: WizardPremiumRateField; idx: number }>;
  assignedGroups: Array<{ key: string; name: string; brokerOverride: boolean }>;
  eligibilityCategories: WizardExtractedProduct['eligibility']['categories'];
  onUpdatePlan: (patch: Partial<WizardPlanField>) => void;
  onRemovePlan: () => void;
  onAddRate: () => void;
  onUpdateRate: (rateIdx: number, patch: Partial<WizardPremiumRateField>) => void;
  onRemoveRate: (rateIdx: number) => void;
}) {
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const showMultiplierCol = plan.coverBasis === 'salary_multiple';

  const categoryMultiplier = (blockLabel: string | null | undefined): number | null => {
    if (!blockLabel || !showMultiplierCol) return null;
    const exact = eligibilityCategories.find((c) => c.category === blockLabel);
    if (exact) return exact.multiplier ?? null;
    const partial = eligibilityCategories.find(
      (c) => c.category.startsWith(blockLabel) || blockLabel.startsWith(c.category),
    );
    return partial?.multiplier ?? null;
  };

  return (
    <Card className="card-padded">
      <div
        className="row"
        style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        <input
          className="input"
          type="text"
          value={plan.code}
          onChange={(e) => onUpdatePlan({ code: e.target.value.toUpperCase() })}
          style={{ width: '6rem', fontWeight: 600 }}
          aria-label={`Plan ${planIdx + 1} code`}
        />
        <input
          className="input"
          type="text"
          value={plan.name}
          onChange={(e) => onUpdatePlan({ name: e.target.value })}
          style={{ flex: 1, minWidth: '10rem' }}
          aria-label={`Plan ${planIdx + 1} name`}
        />
        <select
          className="input"
          value={plan.coverBasis}
          onChange={(e) =>
            onUpdatePlan({ coverBasis: e.target.value as WizardPlanField['coverBasis'] })
          }
          style={{ width: '12rem' }}
        >
          {COVER_BASIS_OPTIONS.map((cb) => (
            <option key={cb} value={cb}>
              {COVER_BASIS_LABELS[cb]}
            </option>
          ))}
        </select>
        <ScheduleEditor
          schedule={plan.schedule}
          coverBasis={plan.coverBasis}
          onChange={(schedule) => onUpdatePlan({ schedule })}
        />
        <ConfidenceBadge confidence={plan.confidence} variant="dot" />
        <button type="button" className="btn btn-danger btn-sm" onClick={onRemovePlan}>
          Remove
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
        <p className="eyebrow mb-2">Premium rates</p>
        {planRates.length === 0 ? (
          <p className="field-help mb-2">No rates for this plan yet.</p>
        ) : (
          <div className="table-wrap mb-2">
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Block</th>
                  <th>Age</th>
                  {showMultiplierCol ? <th>Multiplier</th> : null}
                  <th>Rate / 1,000</th>
                  <th>Fixed amount</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {planRates.map(({ rate, idx }) => (
                  <tr key={idx}>
                    <td>
                      <select
                        className="input"
                        value={rate.coverTier ?? ''}
                        onChange={(e) => onUpdateRate(idx, { coverTier: e.target.value || null })}
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
                        onChange={(e) => onUpdateRate(idx, { blockLabel: e.target.value || null })}
                        style={{ width: '7rem' }}
                        placeholder="(all)"
                      />
                    </td>
                    {showMultiplierCol ? (
                      <td>
                        {(() => {
                          const m = categoryMultiplier(rate.blockLabel);
                          return m != null ? (
                            <span
                              className="text-muted"
                              style={{ fontSize: 'var(--font-sm)', whiteSpace: 'nowrap' }}
                            >
                              {m}× salary
                            </span>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
                              —
                            </span>
                          );
                        })()}
                      </td>
                    ) : null}
                    <td>
                      <div className="row" style={{ gap: '0.15rem', alignItems: 'center' }}>
                        <input
                          className="input"
                          type="number"
                          value={rate.ageBand?.from ?? ''}
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            onUpdateRate(idx, {
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
                            onUpdateRate(idx, {
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
                          onUpdateRate(idx, {
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
                          onUpdateRate(idx, {
                            fixedAmount: Number.isFinite(n) ? n : null,
                          });
                        }}
                        style={{ width: '7rem' }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => onRemoveRate(idx)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAddRate}>
          + Add rate
        </button>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border)',
          paddingTop: '0.75rem',
          marginTop: '0.75rem',
        }}
      >
        <button
          type="button"
          className="row"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            gap: '0.4rem',
          }}
          onClick={() => setGroupsExpanded((v) => !v)}
        >
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
            {groupsExpanded ? '▼' : '▶'}
          </span>
          <span className="eyebrow">Benefit groups</span>
          <span className="pill pill-muted">{assignedGroups.length}</span>
          {!groupsExpanded ? (
            <span
              className="text-muted"
              style={{ fontSize: 'var(--font-sm)', marginLeft: '0.25rem' }}
            >
              {assignedGroups.length === 0
                ? '— none assigned'
                : assignedGroups
                    .slice(0, 2)
                    .map((g) => g.name)
                    .join(', ') + (assignedGroups.length > 2 ? '…' : '')}
            </span>
          ) : null}
        </button>

        {groupsExpanded ? (
          <div style={{ marginTop: '0.5rem' }}>
            {assignedGroups.length === 0 ? (
              <p className="field-help mb-0">
                No benefit groups assigned to this plan yet. Assign them in the{' '}
                <strong>Groups</strong> tab.
              </p>
            ) : (
              <ul
                style={{
                  margin: '0 0 0 0.75rem',
                  padding: 0,
                  listStyle: 'disc',
                  fontSize: 'var(--font-sm)',
                }}
              >
                {assignedGroups.map((g) => (
                  <li key={g.key} style={{ marginBottom: '0.2rem' }}>
                    {g.name}
                    <span
                      style={{
                        marginLeft: '0.4rem',
                        fontSize: 'var(--font-xs)',
                        color: g.brokerOverride ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {g.brokerOverride ? 'edited' : 'AI'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function PlansRatesTab({
  product,
  onChange,
  draft,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
  draft: { id: string; progress: unknown };
}) {
  const bundledWith = (product.header as Record<string, unknown>).bundledWithProductCode as
    | string
    | undefined;

  // Compute plan → rates mapping (stable per render)
  const ratesByPlan = useMemo(() => {
    const map = new Map<string, Array<{ rate: WizardPremiumRateField; idx: number }>>();
    product.premiumRates.forEach((r, i) => {
      const list = map.get(r.planRawCode) ?? [];
      list.push({ rate: r, idx: i });
      map.set(r.planRawCode, list);
    });
    return map;
  }, [product.premiumRates]);

  // Compute suggestion + eligibility data — only changes when draft is saved
  const draftEligibility = useMemo(() => {
    const suggestions = suggestionsFromDraft(draft.progress);
    const categories = deriveEmployeeCategories(suggestions);
    const eligOverride = readBrokerOverride<EligibilityOverride>(draft.progress, 'eligibility', {
      groups: {},
    });
    return { suggestions, categories, eligOverride };
  }, [draft.progress]);

  // Compute plan → benefit groups; only re-runs when plans or product identity changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: member-expression deps intentionally narrow recomputation
  const groupsByPlan = useMemo(() => {
    const { suggestions, categories, eligOverride } = draftEligibility;
    const pa = buildProductAssignments([product], categories, suggestions, eligOverride.groups)[0];
    const map = new Map<string, Array<{ key: string; name: string; brokerOverride: boolean }>>();
    for (const plan of product.plans) map.set(plan.rawCode, []);
    for (const a of pa?.assignments ?? []) {
      if (!a.effectivePlan || a.effectivePlan === INELIGIBLE) continue;
      const list = map.get(a.effectivePlan) ?? [];
      list.push({
        key: a.categoryKey,
        name: a.categoryName,
        brokerOverride: !!a.brokerOverridePlan,
      });
      map.set(a.effectivePlan, list);
    }
    return map;
  }, [draftEligibility, product.plans, product.productTypeCode, product.insurerCode]);

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
          coverBasis: 'fixed_amount' as const,
          stacksOnRawCode: null,
          selectionMode: 'broker_default' as const,
          schedule: {},
          confidence: 1,
        },
      ],
    }));
  };

  const removePlan = (idx: number) => {
    onChange((p) => ({ ...p, plans: p.plans.filter((_, i) => i !== idx) }));
  };

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
          <h3 className="mb-3">Plans &amp; rates</h3>
          <p className="field-help mb-0">
            <strong>Bundled with {bundledWith}.</strong> This product&rsquo;s premium is rolled into
            the {bundledWith} product&rsquo;s rates. No separate rate rows are expected here.
          </p>
        </Card>
      </section>
    );
  }

  if (product.plans.length === 0) {
    return (
      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-2">Plans &amp; rates</h3>
          <p className="field-help mb-3">No plans yet. Add one below.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addPlan}>
            + Add plan
          </button>
        </Card>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
        {product.plans.map((plan, idx) => (
          <PlanCard
            key={`plan-${idx}-${plan.code}`}
            plan={plan}
            planIdx={idx}
            planRates={ratesByPlan.get(plan.rawCode) ?? []}
            assignedGroups={groupsByPlan.get(plan.rawCode) ?? []}
            eligibilityCategories={product.eligibility.categories}
            onUpdatePlan={(patch) => updatePlan(idx, patch)}
            onRemovePlan={() => removePlan(idx)}
            onAddRate={() => addRate(plan.rawCode)}
            onUpdateRate={updateRate}
            onRemoveRate={removeRate}
          />
        ))}
      </div>
      <div className="mt-3">
        <button type="button" className="btn btn-ghost" onClick={addPlan}>
          + Add plan
        </button>
      </div>
    </section>
  );
}
