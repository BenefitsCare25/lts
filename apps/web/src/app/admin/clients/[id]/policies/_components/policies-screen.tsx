// =============================================================
// Policies list for one client. Creation lives at
// /admin/clients/[id]/policies/new.
// =============================================================

'use client';

import { EmptyListState, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

export function ClientPoliciesScreen({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.policies.listByClient.useQuery({ clientId });

  const remove = trpc.policies.delete.useMutation({
    onSuccess: () => {
      setDeleteError(null);
      utils.policies.listByClient.invalidate({ clientId });
    },
    onError: (err) => setDeleteError(err.message),
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <ScreenShell
      title="Policies"
      actions={
        <Link href={`/admin/clients/${clientId}/policies/new`} className="btn btn-primary">
          + New policy
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
                  <th>Entities</th>
                  <th>Benefit years</th>
                  <th>Version</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p._count.entities}</td>
                    <td>{p._count.benefitYears}</td>
                    <td>v{p.versionId}</td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/clients/${clientId}/policies/${p.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${p.name}? This cannot be undone.`)) {
                              remove.mutate({ id: p.id });
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
            message="No policies yet for this client."
            actionHref={`/admin/clients/${clientId}/policies/new`}
            actionLabel="+ Add the first policy"
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
