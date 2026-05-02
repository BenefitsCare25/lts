'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import type { WizardExtractedProduct, WizardPlanField } from '../_types';
import { COVER_BASIS_LABELS, COVER_BASIS_OPTIONS, type ProductPatcher } from './shared';

// ── NumberInput (used only within PlansTab / ScheduleEditor) ──

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

// ── ScheduleEditor (used only within PlansTab) ────────────────

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

// ── PlansTab ──────────────────────────────────────────────────

export function PlansTab({
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
