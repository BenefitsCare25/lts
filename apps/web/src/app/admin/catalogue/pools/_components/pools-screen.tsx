// =============================================================
// Pools list. Creation lives at /admin/catalogue/pools/new.
// =============================================================

'use client';

import { EmptyListState, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export function PoolsScreen() {
  const utils = trpc.useUtils();
  const pools = trpc.pools.list.useQuery();
  const insurers = trpc.insurers.list.useQuery();
  const remove = trpc.pools.delete.useMutation({
    onSuccess: () => {
      setDeleteError(null);
      utils.pools.list.invalidate();
    },
    onError: (err) => setDeleteError(err.message),
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const insurerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of insurers.data ?? []) map.set(i.id, i.name);
    return map;
  }, [insurers.data]);

  return (
    <ScreenShell
      title="Pools"
      actions={
        <Link href="/admin/catalogue/pools/new" className="btn btn-primary">
          + New pool
        </Link>
      }
    >
      <section className="section">
        {pools.isLoading ? (
          <p>Loading…</p>
        ) : pools.error ? (
          <p className="field-error">Failed to load: {pools.error.message}</p>
        ) : pools.data && pools.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Members</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pools.data.map((pool) => (
                  <tr key={pool.id}>
                    <td>{pool.name}</td>
                    <td>{pool.description ?? '—'}</td>
                    <td>
                      {pool.members.length === 0
                        ? '—'
                        : pool.members
                            .map((m) => {
                              const name = insurerById.get(m.insurerId) ?? m.insurerId;
                              return m.shareBps == null
                                ? name
                                : `${name} (${(m.shareBps / 100).toFixed(0)}%)`;
                            })
                            .join(', ')}
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/catalogue/pools/${pool.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${pool.name}? This cannot be undone.`)) {
                              remove.mutate({ id: pool.id });
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
            message="No pools yet."
            actionHref="/admin/catalogue/pools/new"
            actionLabel="+ Add your first pool"
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
