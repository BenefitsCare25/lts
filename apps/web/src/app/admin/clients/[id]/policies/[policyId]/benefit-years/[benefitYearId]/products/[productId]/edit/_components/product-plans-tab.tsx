// =============================================================
// ProductPlansTab — Screen 5b plans table.
//
// Shows existing plans on the product. "Add plan" deep-links to a
// per-plan editor (separate page) where the schedule sub-form is
// rendered via @rjsf. Stacked riders show the base plan code in
// the stacksOn column.
// =============================================================

'use client';

import { formatDate } from '@/lib/format-date';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo } from 'react';

export function ProductPlansTab({
  clientId,
  policyId,
  benefitYearId,
  productId,
  editable,
}: {
  clientId: string;
  policyId: string;
  benefitYearId: string;
  productId: string;
  editable: boolean;
}) {
  const utils = trpc.useUtils();
  const list = trpc.plans.listByProduct.useQuery({ productId });
  const remove = trpc.plans.delete.useMutation({
    onSuccess: () => utils.plans.listByProduct.invalidate({ productId }),
  });

  // Map plan ids → codes for the stacksOn column display.
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of list.data ?? []) m.set(p.id, p.code);
    return m;
  }, [list.data]);

  const productHref = `/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${productId}`;

  return (
    <section className="section">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Plans</h3>
        {editable ? (
          <Link href={`${productHref}/plans/new`} className="btn btn-primary btn-sm">
            + Add plan
          </Link>
        ) : null}
      </div>

      {list.isLoading ? (
        <p>Loading…</p>
      ) : list.error ? (
        <p className="field-error">Failed to load: {list.error.message}</p>
      ) : list.data && list.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Cover basis</th>
                <th>Stacks on</th>
                <th>Selection</th>
                <th>Effective</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <code>{p.code}</code>
                  </td>
                  <td>{p.name}</td>
                  <td>{p.coverBasis}</td>
                  <td>
                    {p.stacksOn ? <code>{codeById.get(p.stacksOn) ?? p.stacksOn}</code> : '—'}
                  </td>
                  <td>{p.selectionMode === 'employee_flex' ? 'Flex' : 'Default'}</td>
                  <td style={{ fontSize: 'var(--font-md, 12px)' }}>
                    {p.effectiveFrom
                      ? `${formatDate(p.effectiveFrom)}${p.effectiveTo ? ` → ${formatDate(p.effectiveTo)}` : ''}`
                      : '—'}
                  </td>
                  <td>
                    <div className="row-end">
                      <Link
                        href={`${productHref}/plans/${p.id}/edit`}
                        className="btn btn-ghost btn-sm"
                      >
                        {editable ? 'Edit' : 'View'}
                      </Link>
                      {editable ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete plan ${p.code}?`)) {
                              remove.mutate({ id: p.id });
                            }
                          }}
                          disabled={remove.isPending}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-padded text-center">
          <p className="mb-0">
            {editable
              ? 'No plans yet — click "Add plan" to create the first.'
              : 'No plans defined.'}
          </p>
        </div>
      )}
    </section>
  );
}
