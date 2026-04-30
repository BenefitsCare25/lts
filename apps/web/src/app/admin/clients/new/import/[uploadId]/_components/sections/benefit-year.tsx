// =============================================================
// BenefitYearSection — Policy name + age basis + benefit-year dates.
// The age-basis radio set drives how the predicate engine resolves
// employee.age_next_birthday (Policy.ageBasis added in
// 20260430140000_wizard_foundation).
// =============================================================

'use client';

import { Card } from '@/components/ui';
import type { DraftFormState } from './_registry';

type Props = {
  form: DraftFormState;
  setForm: React.Dispatch<React.SetStateAction<DraftFormState>>;
};

export function BenefitYearSection({ form, setForm }: Props) {
  const updatePolicy = <K extends keyof DraftFormState['policy']>(
    key: K,
    value: DraftFormState['policy'][K],
  ) => setForm((prev) => ({ ...prev, policy: { ...prev.policy, [key]: value } }));

  const updateBy = <K extends keyof DraftFormState['benefitYear']>(
    key: K,
    value: DraftFormState['benefitYear'][K],
  ) => setForm((prev) => ({ ...prev, benefitYear: { ...prev.benefitYear, [key]: value } }));

  return (
    <>
      <h2>Benefit year</h2>

      <section className="section">
        <Card className="card-padded">
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="by-policy-name">
                Policy name
              </label>
              <input
                id="by-policy-name"
                className="input"
                type="text"
                required
                maxLength={200}
                value={form.policy.name}
                onChange={(e) => updatePolicy('name', e.target.value)}
                placeholder="Master Group Policy 2026"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="by-start">
                Period start
              </label>
              <input
                id="by-start"
                className="input"
                type="date"
                required
                value={form.benefitYear.startDate}
                onChange={(e) => updateBy('startDate', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="by-end">
                Period end
              </label>
              <input
                id="by-end"
                className="input"
                type="date"
                required
                value={form.benefitYear.endDate}
                onChange={(e) => updateBy('endDate', e.target.value)}
              />
            </div>

            <fieldset className="fieldset field-span-full">
              <legend>Age basis</legend>
              <p className="field-help">
                How an employee&rsquo;s age-next-birthday is computed for eligibility predicates.
              </p>
              <div className="row">
                <label className="chip">
                  <input
                    type="radio"
                    name="age-basis"
                    value="POLICY_START"
                    checked={form.policy.ageBasis === 'POLICY_START'}
                    onChange={() => updatePolicy('ageBasis', 'POLICY_START')}
                  />
                  Age at policy start
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="age-basis"
                    value="HIRE_DATE"
                    checked={form.policy.ageBasis === 'HIRE_DATE'}
                    onChange={() => updatePolicy('ageBasis', 'HIRE_DATE')}
                  />
                  Age at hire date
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="age-basis"
                    value="AS_AT_EVENT"
                    checked={form.policy.ageBasis === 'AS_AT_EVENT'}
                    onChange={() => updatePolicy('ageBasis', 'AS_AT_EVENT')}
                  />
                  Age recomputed at each event
                </label>
              </div>
            </fieldset>
          </div>
        </Card>
      </section>
    </>
  );
}
