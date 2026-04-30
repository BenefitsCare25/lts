// =============================================================
// Insurers list. Creation lives at /admin/catalogue/insurers/new
// (the "+ New insurer" action in the screen-shell head).
// =============================================================

'use client';

import { EmptyListState, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

export function InsurersScreen() {
  const utils = trpc.useUtils();
  const list = trpc.insurers.list.useQuery();
  const remove = trpc.insurers.delete.useMutation({
    onSuccess: () => {
      setDeleteError(null);
      utils.insurers.list.invalidate();
    },
    onError: (err) => setDeleteError(err.message),
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <ScreenShell
      title="Insurers"
      actions={
        <Link href="/admin/catalogue/insurers/new" className="btn btn-primary">
          + New insurer
        </Link>
      }
    >
      <section className="section">
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Products</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((insurer) => (
                  <tr key={insurer.id}>
                    <td>{insurer.name}</td>
                    <td>
                      <code>{insurer.code}</code>
                    </td>
                    <td>{insurer.productsSupported.join(', ') || '—'}</td>
                    <td>
                      <span className={insurer.active ? 'pill pill-success' : 'pill pill-muted'}>
                        {insurer.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/catalogue/insurers/${insurer.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${insurer.name}? This cannot be undone.`)) {
                              remove.mutate({ id: insurer.id });
                            }
                          }}
                          disabled={remove.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyListState
            message="No insurers yet."
            actionHref="/admin/catalogue/insurers/new"
            actionLabel="+ Add your first insurer"
          />
        )}

        {deleteError ? (
          <p className="field-error mt-3" role="alert">
            {deleteError}
          </p>
        ) : null}
      </section>
    </ScreenShell>
  );
}
