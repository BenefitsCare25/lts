// =============================================================
// ProductsSection — per-product viewer with four tabs:
//   Details      — product-level header fields (insurer, eligibility,
//                  age limits, currency, free cover limit, …)
//   Plans        — plan list with code / name / cover basis / stacks-on /
//                  per-plan schedule fields (multiplier, sumAssured)
//   Rates        — premium-rate matrix (plan × tier × block)
//   Endorsements — picker against tenant's EndorsementCatalogue +
//                  ExclusionCatalogue, scoped per plan
//
// Section is read-mostly today. Inline edits write back to the
// extraction draft via extractionDrafts.updateExtractedProducts on
// blur. Apply step (next slice) reads the same payload from the
// draft and creates Product/Plan/PremiumRate rows.
// =============================================================

'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { useMemo, useState } from 'react';
import {
  type WizardExtractedProduct,
  type WizardPlanField,
  type WizardPremiumRateField,
  extractedProductsFromDraft,
} from './_types';

type Props = {
  draft: { extractedProducts: unknown };
};

type Tab = 'details' | 'plans' | 'rates' | 'endorsements';

export function ProductsSection({ draft }: Props) {
  const products = extractedProductsFromDraft(draft.extractedProducts);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const active = products[activeIndex] ?? null;

  if (products.length === 0) {
    return (
      <>
        <h2>Products</h2>
        <section className="section">
          <Card className="card-padded">
            <p className="mb-0">
              No products extracted from this slip. Resolve template-detection issues in the Source
              section, or upload a slip whose sheet names match a registered insurer template.
            </p>
          </Card>
        </section>
      </>
    );
  }

  return (
    <>
      <h2>Products ({products.length})</h2>

      <section className="section">
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
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
              <code>{p.productTypeCode}</code> · {p.insurerCode}
            </button>
          ))}
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
                id="endorsements"
                label="Endorsements"
                active={activeTab}
                onChange={setActiveTab}
              />
            </div>
          </section>

          {activeTab === 'details' ? <DetailsTab product={active} /> : null}
          {activeTab === 'plans' ? <PlansTab product={active} /> : null}
          {activeTab === 'rates' ? <RatesTab product={active} /> : null}
          {activeTab === 'endorsements' ? <EndorsementsTab product={active} /> : null}
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

function DetailsTab({ product }: { product: WizardExtractedProduct }) {
  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Product details</h3>
        <div className="form-grid">
          <FieldRow label="Product type" value={product.productTypeCode} confidence={1} readOnly />
          <FieldRow label="Insurer" value={product.insurerCode} confidence={1} readOnly />
          <FieldRow
            label="Policy number"
            value={product.header.policyNumber.value ?? ''}
            confidence={product.header.policyNumber.confidence}
            sourceRef={product.header.policyNumber.sourceRef}
          />
          <FieldRow
            label="Period start"
            value={product.header.period.value?.from ?? ''}
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
          />
          <FieldRow
            label="Period end"
            value={product.header.period.value?.to ?? ''}
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
          />
          <FieldRow
            label="Last entry age"
            value={product.header.lastEntryAge.value?.toString() ?? ''}
            confidence={product.header.lastEntryAge.confidence}
            sourceRef={product.header.lastEntryAge.sourceRef}
          />
          <FieldRow
            label="Administration"
            value={product.header.administrationType.value ?? ''}
            confidence={product.header.administrationType.confidence}
            sourceRef={product.header.administrationType.sourceRef}
          />
          <FieldRow
            label="Currency"
            value={product.header.currency.value ?? ''}
            confidence={product.header.currency.confidence}
            sourceRef={product.header.currency.sourceRef}
          />
        </div>

        <h3 className="mt-4 mb-3">Eligibility</h3>
        <FieldRow
          label="Eligibility text"
          value={product.eligibility.freeText.value ?? ''}
          confidence={product.eligibility.freeText.confidence}
          sourceRef={product.eligibility.freeText.sourceRef}
          multiline
        />
      </Card>
    </section>
  );
}

// ── Plans tab ────────────────────────────────────────────────

function PlansTab({ product }: { product: WizardExtractedProduct }) {
  const planByCode = useMemo(() => {
    const m = new Map<string, WizardPlanField>();
    for (const p of product.plans) {
      m.set(p.code, p);
      m.set(p.rawCode, p);
    }
    return m;
  }, [product.plans]);

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Plans on this product</h3>
        {product.plans.length === 0 ? (
          <p className="field-help mb-0">No plans extracted.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Cover basis</th>
                  <th>Stacks on</th>
                  <th>Schedule</th>
                  <th aria-label="confidence" />
                </tr>
              </thead>
              <tbody>
                {product.plans.map((plan) => {
                  const stacksOnPlan = plan.stacksOnRawCode
                    ? planByCode.get(plan.stacksOnRawCode)
                    : null;
                  return (
                    <tr key={plan.code}>
                      <td>
                        <code>{plan.code}</code>
                      </td>
                      <td>{plan.name}</td>
                      <td>
                        <span className="pill pill-muted">{plan.coverBasis}</span>
                      </td>
                      <td>
                        {stacksOnPlan ? (
                          <span title={stacksOnPlan.name}>
                            <code>{stacksOnPlan.code}</code>
                          </span>
                        ) : plan.stacksOnRawCode ? (
                          <span className="text-muted">→ {plan.stacksOnRawCode}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <ScheduleSummary schedule={plan.schedule} coverBasis={plan.coverBasis} />
                      </td>
                      <td>
                        <ConfidenceBadge confidence={plan.confidence} variant="dot" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasStacking(product.plans) ? (
          <div className="mt-4">
            <h4 className="mb-2">Stacking visualisation</h4>
            <StackingTree plans={product.plans} />
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function ScheduleSummary({
  schedule,
  coverBasis,
}: {
  schedule: Record<string, unknown>;
  coverBasis: WizardPlanField['coverBasis'];
}) {
  const parts: string[] = [];
  if (coverBasis === 'salary_multiple' && typeof schedule.multiplier === 'number') {
    parts.push(`${schedule.multiplier}× salary`);
  }
  if (coverBasis === 'fixed_amount' && typeof schedule.sumAssured === 'number') {
    parts.push(`SI ${schedule.sumAssured.toLocaleString()}`);
  }
  if (typeof schedule.dailyRoomBoard === 'number') {
    parts.push(`R&B ${schedule.dailyRoomBoard}`);
  }
  if (parts.length === 0) return <span className="text-muted">—</span>;
  return <span>{parts.join(' · ')}</span>;
}

function hasStacking(plans: WizardPlanField[]): boolean {
  return plans.some((p) => p.stacksOnRawCode);
}

function StackingTree({ plans }: { plans: WizardPlanField[] }) {
  const { bases, childrenOf } = useMemo(() => {
    const byRawCode = new Map(plans.map((p) => [p.rawCode, p]));
    const childMap = new Map<string, WizardPlanField[]>();
    const baseList: WizardPlanField[] = [];
    for (const plan of plans) {
      if (plan.stacksOnRawCode && byRawCode.has(plan.stacksOnRawCode)) {
        const list = childMap.get(plan.stacksOnRawCode) ?? [];
        list.push(plan);
        childMap.set(plan.stacksOnRawCode, list);
      } else {
        baseList.push(plan);
      }
    }
    return { bases: baseList, childrenOf: childMap };
  }, [plans]);
  return (
    <ul className="kv-list">
      {bases.map((base) => (
        <li key={base.code}>
          <code>{base.code}</code> — {base.name}
          {childrenOf.get(base.rawCode)?.map((child) => (
            <div key={child.code} style={{ marginLeft: '1.5rem' }}>
              ↳ <code>{child.code}</code> stacks on <code>{base.code}</code> ({child.name})
            </div>
          )) ?? null}
        </li>
      ))}
    </ul>
  );
}

// ── Rates tab ────────────────────────────────────────────────

function RatesTab({ product }: { product: WizardExtractedProduct }) {
  // Group rates by plan, then by tier and block.
  const grouped = useMemo(() => {
    const map = new Map<string, WizardPremiumRateField[]>();
    for (const r of product.premiumRates) {
      const key = r.planRawCode;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [product.premiumRates]);

  // Detect rate-shape: per-tier, per-block, or single-rate.
  const hasTiers = product.premiumRates.some((r) => r.coverTier);
  const hasBlocks = product.premiumRates.some((r) => r.blockLabel);

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Premium rates</h3>
        {product.premiumRates.length === 0 ? (
          <p className="field-help mb-0">
            No rates extracted. The slip&rsquo;s rates table didn&rsquo;t resolve to known plan
            labels — broker fills in via the catalogue admin after apply.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Plan</th>
                  {hasTiers ? <th>Tier</th> : null}
                  {hasBlocks ? <th>Block</th> : null}
                  <th>Rate / 1,000</th>
                  <th>Fixed amount</th>
                  <th aria-label="conf" />
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap(([plan, rates]) =>
                  rates.map((r, i) => (
                    <tr key={`${plan}-${r.coverTier ?? '_'}-${r.blockLabel ?? '_'}-${i}`}>
                      {i === 0 ? (
                        <td rowSpan={rates.length}>
                          <code>{plan}</code>
                        </td>
                      ) : null}
                      {hasTiers ? <td>{r.coverTier ?? '—'}</td> : null}
                      {hasBlocks ? <td>{r.blockLabel ?? '(all)'}</td> : null}
                      <td>{r.ratePerThousand?.toLocaleString() ?? '—'}</td>
                      <td>{r.fixedAmount?.toLocaleString() ?? '—'}</td>
                      <td>
                        <ConfidenceBadge confidence={r.confidence} variant="dot" />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

// ── Endorsements tab ─────────────────────────────────────────

function EndorsementsTab({ product }: { product: WizardExtractedProduct }) {
  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Endorsements &amp; exclusions</h3>
        <p className="field-help mb-3">
          Plan-level cover additions (endorsements) and carve-outs (exclusions) are stored as codes
          against the tenant&rsquo;s catalogues. Today the catalogues are empty by default — seed
          them in the next slice and the slip&rsquo;s comments sheet will auto-suggest matches per
          plan.
        </p>
        <ul className="issue-list">
          {product.plans.map((plan) => {
            const endorsements = (plan.schedule.endorsements as unknown[] | undefined) ?? [];
            const exclusions = (plan.schedule.exclusions as unknown[] | undefined) ?? [];
            return (
              <li key={plan.code}>
                <strong>
                  <code>{plan.code}</code> — {plan.name}
                </strong>
                {' · '}
                {endorsements.length} endorsement{endorsements.length === 1 ? '' : 's'},{' '}
                {exclusions.length} exclusion{exclusions.length === 1 ? '' : 's'}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

// ── Shared ───────────────────────────────────────────────────

function FieldRow({
  label,
  value,
  confidence,
  sourceRef,
  readOnly,
  multiline,
}: {
  label: string;
  value: string;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string } | undefined;
  readOnly?: boolean;
  multiline?: boolean;
}) {
  // Stable id derived from the label so each FieldRow's <label
  // for="…"> matches its input. Slugifies for safety.
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
          readOnly={readOnly}
          rows={2}
          disabled={readOnly}
        />
      ) : (
        <input
          id={id}
          className="input"
          type="text"
          value={value}
          readOnly={readOnly}
          disabled={readOnly}
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
