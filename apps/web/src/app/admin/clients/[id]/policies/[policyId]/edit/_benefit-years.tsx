// =============================================================
// BenefitYearsSection — list + add + state-transition controls
// for one policy. Drops in below the policy form on the edit page.
// Mutations use the benefitYears tRPC router (S17).
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

type BenefitYearState = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

const formatDate = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};

const stateLabel = (state: BenefitYearState): { className: string; text: string } => {
  switch (state) {
    case 'DRAFT':
      return { className: 'pill pill-muted', text: 'Draft' };
    case 'PUBLISHED':
      return { className: 'pill pill-success', text: 'Published' };
    case 'ARCHIVED':
      return { className: 'pill pill-muted', text: 'Archived' };
  }
};

export function BenefitYearsSection({
  clientId,
  policyId,
}: {
  clientId: string;
  policyId: string;
}) {
  const utils = trpc.useUtils();
  const list = trpc.benefitYears.listByPolicy.useQuery({ policyId });

  const create = trpc.benefitYears.create.useMutation({
    onSuccess: async () => {
      setNewStart('');
      setNewEnd('');
      setError(null);
      await utils.benefitYears.listByPolicy.invalidate({ policyId });
    },
    onError: (err) => setError(err.message),
  });
  const setState = trpc.benefitYears.setState.useMutation({
    onSuccess: () => utils.benefitYears.listByPolicy.invalidate({ policyId }),
    onError: (err) => setError(err.message),
  });
  const updateDates = trpc.benefitYears.updateDates.useMutation({
    onSuccess: () => utils.benefitYears.listByPolicy.invalidate({ policyId }),
    onError: (err) => setError(err.message),
  });

  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      policyId,
      startDate: new Date(newStart),
      endDate: new Date(newEnd),
    });
  };

  const startEdit = (id: string, start: Date | string, end: Date | string) => {
    setEditingId(id);
    setEditStart(formatDate(start));
    setEditEnd(formatDate(end));
  };

  const saveEdit = (id: string) => {
    setError(null);
    updateDates.mutate({
      id,
      startDate: new Date(editStart),
      endDate: new Date(editEnd),
    });
    setEditingId(null);
  };

  return (
    <section className="section">
      <h3 style={{ marginBottom: '0.75rem' }}>Benefit years</h3>
      <p className="field-help" style={{ marginBottom: '1rem', maxWidth: '60ch' }}>
        Each benefit year is a versioned snapshot of products, plans, and eligibility for a coverage
        period. The first year is created automatically when the policy is added — publish it to
        lock the configuration, then add next year's draft for renewal.
      </p>

      {list.isLoading ? (
        <p>Loading…</p>
      ) : list.error ? (
        <p className="field-error">Failed to load: {list.error.message}</p>
      ) : list.data && list.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>State</th>
                <th>Products</th>
                <th>Published</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((by) => {
                const tag = stateLabel(by.state);
                const isEditing = editingId === by.id;
                return (
                  <tr key={by.id}>
                    <td>
                      {isEditing ? (
                        <div className="row">
                          <input
                            className="input"
                            type="date"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                          />
                          <span>→</span>
                          <input
                            className="input"
                            type="date"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                          />
                        </div>
                      ) : (
                        <code>
                          {formatDate(by.startDate)} → {formatDate(by.endDate)}
                        </code>
                      )}
                    </td>
                    <td>
                      <span className={tag.className}>{tag.text}</span>
                    </td>
                    <td>{by._count.products}</td>
                    <td>{by.publishedAt ? formatDate(by.publishedAt) : '—'}</td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/clients/${clientId}/policies/${policyId}/benefit-years/${by.id}/products`}
                          className="btn btn-ghost btn-sm"
                        >
                          Products
                        </Link>
                        {by.state === 'DRAFT' && !isEditing ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => startEdit(by.id, by.startDate, by.endDate)}
                            >
                              Edit dates
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'Publish this benefit year? Configuration will be locked.',
                                  )
                                ) {
                                  setState.mutate({ id: by.id, state: 'PUBLISHED' });
                                }
                              }}
                              disabled={setState.isPending}
                            >
                              Publish
                            </button>
                          </>
                        ) : null}
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => saveEdit(by.id)}
                              disabled={updateDates.isPending}
                            >
                              Save dates
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {by.state !== 'ARCHIVED' && !isEditing ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              if (window.confirm('Archive this benefit year?')) {
                                setState.mutate({ id: by.id, state: 'ARCHIVED' });
                              }
                            }}
                            disabled={setState.isPending}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-padded" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 0 }}>No benefit years yet for this policy.</p>
        </div>
      )}

      <div className="card card-padded" style={{ marginTop: '1rem' }}>
        <h4 style={{ marginBottom: '0.75rem' }}>Add benefit year</h4>
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="by-start">
              Period start
            </label>
            <input
              id="by-start"
              className="input"
              type="date"
              required
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
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
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </div>
          {error ? <p className="field-error">{error}</p> : null}
          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || !newStart || !newEnd}
            >
              {create.isPending ? 'Saving…' : 'Add benefit year'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
