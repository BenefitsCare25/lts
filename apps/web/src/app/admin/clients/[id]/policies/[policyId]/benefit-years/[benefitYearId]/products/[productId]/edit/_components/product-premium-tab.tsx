// =============================================================
// ProductPremiumTab — Screen 5d.
//
// Strategy-aware rate editor + live preview. The strategy code on
// ProductType drives which rate inputs render and which headcount
// shape feeds the preview:
//   per_group_cover_tier — per (plan, group, tier) fixedAmount;
//                           preview uses per-(group, tier) headcount.
//   per_individual_*     — per-plan ratePerThousand;
//                           preview uses per-plan headcount + avg salary.
//   per_headcount_flat   — per-plan fixedAmount; preview uses per-plan headcount.
//   per_individual_earnings — rates live in plan.schedule.earningsBands;
//                           preview uses per-plan headcount + avg earnings.
//
// AC anchor: CUBER GHS computes 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import { useEffect, useMemo, useState } from 'react';

const COVER_TIERS = ['EO', 'ES', 'EC', 'EF'] as const;

type RateRow = {
  planId: string;
  groupId: string | null;
  coverTier: string | null;
  ratePerThousand: number | null;
  fixedAmount: number | null;
};

const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function ProductPremiumTab({ productId }: { productId: string }) {
  const utils = trpc.useUtils();
  const product = trpc.products.byId.useQuery({ id: productId });
  const plansQ = trpc.plans.listByProduct.useQuery({ productId });
  const matrixQ = trpc.productEligibility.matrixForProduct.useQuery({ productId });
  const ratesQ = trpc.premiumRates.listForProduct.useQuery({ productId });

  const save = trpc.premiumRates.setForProduct.useMutation({
    onSuccess: async () => {
      setSaved(true);
      setSaveError(null);
      await utils.premiumRates.listForProduct.invalidate({ productId });
    },
    onError: (err) => {
      setSaveError(err.message);
      setSaved(false);
    },
  });

  // Local rate state — keyed by composite "planId|groupId|tier" (empty
  // segments for missing dimensions). Number values stored as strings
  // to keep half-typed input clean; coerced on save and on preview.
  const [rateMap, setRateMap] = useState<Record<string, string>>({});
  const [initialised, setInitialised] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Headcount inputs — strategy decides which shape to render.
  const [groupTierHc, setGroupTierHc] = useState<Record<string, string>>({});
  const [planHc, setPlanHc] = useState<
    Record<string, { headcount: string; averageSalary: string; averageAnnualEarnings: string }>
  >({});

  const strategy = ratesQ.data?.premiumStrategy ?? null;
  const editable = ratesQ.data?.benefitYearState === 'DRAFT';

  // Hydrate local rate state from the server payload once.
  useEffect(() => {
    if (initialised || !ratesQ.data) return;
    const next: Record<string, string> = {};
    for (const r of ratesQ.data.rates) {
      const key = `${r.planId}|${r.groupId ?? ''}|${r.coverTier ?? ''}`;
      const v = r.fixedAmount ?? r.ratePerThousand ?? 0;
      next[key] = String(v);
    }
    setRateMap(next);
    setInitialised(true);
  }, [ratesQ.data, initialised]);

  const setRate = (key: string, value: string) => {
    setRateMap((prev) => ({ ...prev, [key]: value }));
  };

  // Build the rate payload for save based on the strategy shape.
  const buildSavePayload = (): RateRow[] => {
    if (!strategy) return [];
    const rows: RateRow[] = [];
    if (strategy === 'per_group_cover_tier' && plansQ.data && matrixQ.data) {
      for (const plan of plansQ.data) {
        for (const g of matrixQ.data.groups) {
          for (const tier of COVER_TIERS) {
            const key = `${plan.id}|${g.id}|${tier}`;
            const raw = rateMap[key];
            if (!raw) continue;
            const num = Number.parseFloat(raw);
            if (!Number.isFinite(num) || num <= 0) continue;
            rows.push({
              planId: plan.id,
              groupId: g.id,
              coverTier: tier,
              fixedAmount: num,
              ratePerThousand: null,
            });
          }
        }
      }
    } else if (
      strategy === 'per_individual_salary_multiple' ||
      strategy === 'per_individual_fixed_sum'
    ) {
      for (const plan of plansQ.data ?? []) {
        const key = `${plan.id}||`;
        const raw = rateMap[key];
        if (!raw) continue;
        const num = Number.parseFloat(raw);
        if (!Number.isFinite(num) || num <= 0) continue;
        rows.push({
          planId: plan.id,
          groupId: null,
          coverTier: null,
          ratePerThousand: num,
          fixedAmount: null,
        });
      }
    } else if (strategy === 'per_headcount_flat') {
      for (const plan of plansQ.data ?? []) {
        const key = `${plan.id}||`;
        const raw = rateMap[key];
        if (!raw) continue;
        const num = Number.parseFloat(raw);
        if (!Number.isFinite(num) || num <= 0) continue;
        rows.push({
          planId: plan.id,
          groupId: null,
          coverTier: null,
          fixedAmount: num,
          ratePerThousand: null,
        });
      }
    }
    // per_individual_earnings: rates come from plan.schedule.earningsBands; nothing to save here.
    return rows;
  };

  // S25: as-of date for effective filtering. Empty means "today".
  const [asOf, setAsOf] = useState('');

  // Estimate input — derived from the headcount controls.
  const estimateInput = useMemo(() => {
    if (!strategy) return null;
    if (strategy === 'per_group_cover_tier') {
      const rows: { groupId: string; coverTier: string; headcount: number }[] = [];
      for (const [key, raw] of Object.entries(groupTierHc)) {
        const [groupId, tier] = key.split('|');
        if (!groupId || !tier) continue;
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) continue;
        rows.push({ groupId, coverTier: tier, headcount: n });
      }
      return { groupTierHeadcount: rows };
    }
    const rows: {
      planId: string;
      headcount: number;
      averageSalary?: number;
      averageAnnualEarnings?: number;
    }[] = [];
    for (const [planId, vals] of Object.entries(planHc)) {
      const n = Number.parseInt(vals.headcount, 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      const row: (typeof rows)[number] = { planId, headcount: n };
      const sal = Number.parseFloat(vals.averageSalary);
      if (Number.isFinite(sal) && sal > 0) row.averageSalary = sal;
      const earn = Number.parseFloat(vals.averageAnnualEarnings);
      if (Number.isFinite(earn) && earn > 0) row.averageAnnualEarnings = earn;
      rows.push(row);
    }
    return { planHeadcount: rows };
  }, [strategy, groupTierHc, planHc]);

  const estimate = trpc.premiumRates.estimate.useQuery(
    {
      productId,
      ...(estimateInput ?? {}),
      ...(asOf ? { asOf: new Date(asOf) } : {}),
    },
    { enabled: estimateInput !== null },
  );

  if (
    product.isLoading ||
    plansQ.isLoading ||
    matrixQ.isLoading ||
    ratesQ.isLoading ||
    !ratesQ.data
  ) {
    return <p>Loading…</p>;
  }
  if (ratesQ.error) {
    return <p className="field-error">Failed to load: {ratesQ.error.message}</p>;
  }
  if (!plansQ.data || plansQ.data.length === 0) {
    return (
      <section className="section">
        <div className="card card-padded">
          <p className="mb-0">
            No plans defined yet — add one in the Plans tab before configuring premium.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="card card-padded">
        <h3 style={{ marginBottom: '0.25rem' }}>Premium</h3>
        <p className="field-help" style={{ marginBottom: '1rem' }}>
          Strategy <code>{strategy}</code> is selected automatically from the product type.
        </p>

        {strategy === 'per_group_cover_tier' ? (
          <PerGroupCoverTierEditor
            plans={plansQ.data}
            groups={matrixQ.data?.groups ?? []}
            rateMap={rateMap}
            setRate={setRate}
            editable={!!editable}
          />
        ) : strategy === 'per_individual_salary_multiple' ||
          strategy === 'per_individual_fixed_sum' ? (
          <PerPlanRateEditor
            plans={plansQ.data}
            rateMap={rateMap}
            setRate={setRate}
            label="Rate per $1,000 sum assured"
            editable={!!editable}
          />
        ) : strategy === 'per_headcount_flat' ? (
          <PerPlanRateEditor
            plans={plansQ.data}
            rateMap={rateMap}
            setRate={setRate}
            label="Premium per member"
            editable={!!editable}
          />
        ) : strategy === 'per_individual_earnings' ? (
          <p className="field-help">
            Rates for this strategy live in <code>plan.schedule.earningsBands</code> — edit them on
            each plan. Use the headcount fields below for a preview.
          </p>
        ) : (
          <p className="field-error">No editor for strategy {strategy}.</p>
        )}

        {editable && strategy && strategy !== 'per_individual_earnings' ? (
          <div className="row" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate({ productId, rates: buildSavePayload() })}
            >
              {save.isPending ? 'Saving…' : 'Save rates'}
            </button>
            {saveError ? <p className="field-error">{saveError}</p> : null}
            {saved ? (
              <p
                className="field-help"
                style={{ color: 'var(--color-good, #16a34a)', alignSelf: 'center' }}
              >
                ✓ Saved.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card card-padded mt-4">
        <h3 style={{ marginBottom: '0.25rem' }}>Live preview</h3>
        <p className="field-help mb-3">
          Headcount estimates below are dry-run inputs only — they're not stored. Real headcount
          comes from employee data once Phase 1H lands.
        </p>

        <div className="field" style={{ maxWidth: '14rem', marginBottom: '0.75rem' }}>
          <label className="field-label" htmlFor="prem-asof">
            As of date <span className="field-help-inline">(optional)</span>
          </label>
          <input
            id="prem-asof"
            className="input"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
          <span className="field-help">
            Filters plans by effective window. Leave blank to include every plan.
          </span>
        </div>

        {strategy === 'per_group_cover_tier' ? (
          <GroupTierHeadcountInputs
            groups={matrixQ.data?.groups ?? []}
            values={groupTierHc}
            setValue={(k, v) => setGroupTierHc((prev) => ({ ...prev, [k]: v }))}
          />
        ) : (
          <PerPlanHeadcountInputs
            plans={plansQ.data}
            strategy={strategy}
            values={planHc}
            setValue={(planId, patch) =>
              setPlanHc((prev) => ({
                ...prev,
                [planId]: { ...(prev[planId] ?? defaultPlanHc()), ...patch },
              }))
            }
          />
        )}

        <div style={{ marginTop: '0.75rem', fontSize: 'var(--font-lg, 16px)' }}>
          <strong>Estimated annual premium:</strong>{' '}
          {estimate.isFetching ? (
            <span className="field-help">computing…</span>
          ) : estimate.data ? (
            <span>{fmtMoney(estimate.data.total)}</span>
          ) : (
            <span className="field-help">Enter headcounts above.</span>
          )}
        </div>
        {estimate.data && estimate.data.warnings.length > 0 ? (
          <ul className="field-help" style={{ marginTop: '0.5rem' }}>
            {estimate.data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

const defaultPlanHc = () => ({ headcount: '', averageSalary: '', averageAnnualEarnings: '' });

function PerGroupCoverTierEditor({
  plans,
  groups,
  rateMap,
  setRate,
  editable,
}: {
  plans: { id: string; code: string; name: string }[];
  groups: { id: string; name: string }[];
  rateMap: Record<string, string>;
  setRate: (key: string, value: string) => void;
  editable: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="field-error">
        No benefit groups defined yet — add at least one before entering rates.
      </p>
    );
  }
  return (
    <div className="form-grid" style={{ gap: '1rem' }}>
      {plans.map((plan) => (
        <div key={plan.id} className="card card-padded">
          <h4 style={{ marginBottom: '0.5rem' }}>
            <code>{plan.code}</code> · {plan.name}
          </h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Group</th>
                  {COVER_TIERS.map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    {COVER_TIERS.map((tier) => {
                      const key = `${plan.id}|${g.id}|${tier}`;
                      return (
                        <td key={tier}>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={rateMap[key] ?? ''}
                            onChange={(e) => setRate(key, e.target.value)}
                            disabled={!editable}
                            placeholder="0"
                            style={{ width: '5.5rem' }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function PerPlanRateEditor({
  plans,
  rateMap,
  setRate,
  label,
  editable,
}: {
  plans: { id: string; code: string; name: string }[];
  rateMap: Record<string, string>;
  setRate: (key: string, value: string) => void;
  label: string;
  editable: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>{label}</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => {
            const key = `${plan.id}||`;
            return (
              <tr key={plan.id}>
                <td>
                  <code>{plan.code}</code> · {plan.name}
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={rateMap[key] ?? ''}
                    onChange={(e) => setRate(key, e.target.value)}
                    disabled={!editable}
                    placeholder="0"
                    style={{ width: '8rem' }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupTierHeadcountInputs({
  groups,
  values,
  setValue,
}: {
  groups: { id: string; name: string }[];
  values: Record<string, string>;
  setValue: (k: string, v: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Group</th>
            {COVER_TIERS.map((t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              {COVER_TIERS.map((tier) => {
                const k = `${g.id}|${tier}`;
                return (
                  <td key={tier}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={1}
                      value={values[k] ?? ''}
                      onChange={(e) => setValue(k, e.target.value)}
                      placeholder="0"
                      style={{ width: '4.5rem' }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerPlanHeadcountInputs({
  plans,
  strategy,
  values,
  setValue,
}: {
  plans: { id: string; code: string; name: string }[];
  strategy: string | null;
  values: Record<
    string,
    { headcount: string; averageSalary: string; averageAnnualEarnings: string }
  >;
  setValue: (
    planId: string,
    patch: Partial<{ headcount: string; averageSalary: string; averageAnnualEarnings: string }>,
  ) => void;
}) {
  const showSalary = strategy === 'per_individual_salary_multiple';
  const showEarnings = strategy === 'per_individual_earnings';
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Headcount</th>
            {showSalary ? <th>Avg monthly salary</th> : null}
            {showEarnings ? <th>Avg annual earnings</th> : null}
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => {
            const v = values[p.id] ?? defaultPlanHc();
            return (
              <tr key={p.id}>
                <td>
                  <code>{p.code}</code>
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={1}
                    value={v.headcount}
                    onChange={(e) => setValue(p.id, { headcount: e.target.value })}
                    style={{ width: '5rem' }}
                  />
                </td>
                {showSalary ? (
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={v.averageSalary}
                      onChange={(e) => setValue(p.id, { averageSalary: e.target.value })}
                      style={{ width: '7rem' }}
                    />
                  </td>
                ) : null}
                {showEarnings ? (
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={v.averageAnnualEarnings}
                      onChange={(e) => setValue(p.id, { averageAnnualEarnings: e.target.value })}
                      style={{ width: '8rem' }}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
