// =============================================================
// ProductEligibilityTab — Screen 5c (S23) eligibility list.
//
// Lists every benefit group on the policy with a per-row dropdown
// to pick a default plan (or "ineligible"). Save bulk-replaces all
// rows for the product. Missing assignments (group with no plan
// chosen) become "ineligible" — Screen 6 (S26-27) will flag those.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const INELIGIBLE = '__INELIGIBLE__';

export function ProductEligibilityTab({
  clientId,
  policyId,
  productId,
}: {
  clientId: string;
  policyId: string;
  productId: string;
}) {
  const utils = trpc.useUtils();
  const matrix = trpc.productEligibility.matrixForProduct.useQuery({ productId });
  const save = trpc.productEligibility.setForProduct.useMutation({
    onSuccess: async () => {
      setSaved(true);
      setSaveError(null);
      await utils.productEligibility.matrixForProduct.invalidate({ productId });
    },
    onError: (err) => {
      setSaveError(err.message);
      setSaved(false);
    },
  });

  // Local state: groupId → planId | INELIGIBLE marker. Initialised
  // from the server matrix.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (initialised || !matrix.data) return;
    const next: Record<string, string> = {};
    for (const r of matrix.data.rows) {
      next[r.benefitGroupId] = r.defaultPlanId ?? INELIGIBLE;
    }
    setSelections(next);
    setInitialised(true);
  }, [matrix.data, initialised]);

  if (matrix.isLoading) return <p>Loading…</p>;
  if (matrix.error) return <p className="field-error">Failed to load: {matrix.error.message}</p>;
  if (!matrix.data) return null;

  const editable = matrix.data.benefitYearState === 'DRAFT';
  const { groups, plans } = matrix.data;

  if (groups.length === 0) {
    return (
      <section className="section">
        <div className="card card-padded">
          <p style={{ marginBottom: '0.5rem' }}>No benefit groups on this policy yet.</p>
          <Link
            href={`/admin/clients/${clientId}/policies/${policyId}/benefit-groups`}
            className="btn btn-primary btn-sm"
          >
            Manage benefit groups →
          </Link>
        </div>
      </section>
    );
  }

  if (plans.length === 0) {
    return (
      <section className="section">
        <div className="card card-padded">
          <p style={{ marginBottom: 0 }}>
            No plans defined on this product yet — add a plan in the Plans tab first.
          </p>
        </div>
      </section>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    save.mutate({
      productId,
      entries: groups.map((g) => ({
        benefitGroupId: g.id,
        defaultPlanId:
          selections[g.id] === INELIGIBLE || !selections[g.id] ? null : (selections[g.id] ?? null),
      })),
    });
  };

  return (
    <section className="section">
      <div className="card card-padded">
        <h3 style={{ marginBottom: '0.5rem' }}>Eligibility</h3>
        <p className="field-help" style={{ marginBottom: '1rem' }}>
          Pick the default plan each benefit group lands on for this product. Choose{' '}
          <em>Ineligible</em> when a group should not receive this product at all. Groups left
          unassigned are treated as ineligible — Screen 6 will flag them as warnings.
        </p>

        <form onSubmit={submit} className="form-grid">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Benefit group</th>
                  <th>Default plan</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.name}</strong>
                      {g.description ? (
                        <div className="field-help" style={{ marginTop: '2px' }}>
                          {g.description}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <select
                        className="input"
                        value={selections[g.id] ?? INELIGIBLE}
                        onChange={(e) =>
                          setSelections((prev) => ({ ...prev, [g.id]: e.target.value }))
                        }
                        disabled={!editable}
                      >
                        <option value={INELIGIBLE}>Ineligible</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {saveError ? <p className="field-error">{saveError}</p> : null}
          {saved ? (
            <p className="field-help" style={{ color: 'var(--color-good, #16a34a)' }}>
              ✓ Saved.
            </p>
          ) : null}

          {editable ? (
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save eligibility'}
              </button>
            </div>
          ) : (
            <p className="field-help">
              This benefit year is {matrix.data.benefitYearState.toLowerCase()} — eligibility is
              read-only.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
