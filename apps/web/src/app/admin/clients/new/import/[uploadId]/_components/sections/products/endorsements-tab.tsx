'use client';

import { Card } from '@/components/ui';
import type { WizardExtractedProduct } from '../_types';
import type { ProductPatcher } from './shared';

export function EndorsementsTab({
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
