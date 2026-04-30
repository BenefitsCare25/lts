// =============================================================
// TPAs list. Creation lives at /admin/catalogue/tpas/new.
// =============================================================

'use client';

import { EmptyListState, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export function TpasScreen() {
  const utils = trpc.useUtils();
  const tpas = trpc.tpas.list.useQuery();
  const insurers = trpc.insurers.list.useQuery();
  const remove = trpc.tpas.delete.useMutation({
    onSuccess: () => {
      setDeleteError(null);
      utils.tpas.list.invalidate();
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
      title="TPAs"
      actions={
        <Link href="/admin/catalogue/tpas/new" className="btn btn-primary">
          + New TPA
        </Link>
      }
    >
      <section className="section">
        {tpas.isLoading ? (
          <p>Loading…</p>
        ) : tpas.error ? (
          <p className="field-error">Failed to load: {tpas.error.message}</p>
        ) : tpas.data && tpas.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Supported insurers</th>
                  <th>Feed</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {tpas.data.map((tpa) => (
                  <tr key={tpa.id}>
                    <td>{tpa.name}</td>
                    <td>
                      <code>{tpa.code}</code>
                    </td>
                    <td>
                      {tpa.supportedInsurerIds.length === 0
                        ? '—'
                        : tpa.supportedInsurerIds.map((id) => insurerById.get(id) ?? id).join(', ')}
                    </td>
                    <td>
                      <span className="pill pill-accent">{tpa.feedFormat}</span>
                    </td>
                    <td>
                      <span className={tpa.active ? 'pill pill-success' : 'pill pill-muted'}>
                        {tpa.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/catalogue/tpas/${tpa.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${tpa.name}? This cannot be undone.`)) {
                              remove.mutate({ id: tpa.id });
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
            message="No TPAs yet."
            actionHref="/admin/catalogue/tpas/new"
            actionLabel="+ Add your first TPA"
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
