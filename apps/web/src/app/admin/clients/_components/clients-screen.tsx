// =============================================================
// Clients list (Screen 1, S13).
//
// Listing-only surface. Client creation has moved to
// /admin/clients/new which presents two paths:
//   • Import slip — drop placement slip → AI extracts → wizard
//   • Type details — manual entry of legal entity metadata
//
// The "Add new client" action in the screen-shell head is the
// single entry point into both flows.
// =============================================================

'use client';

import { EmptyListState, ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export function ClientsScreen() {
  const utils = trpc.useUtils();
  const list = trpc.clients.list.useQuery();
  const countries = trpc.referenceData.countries.useQuery();

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = trpc.clients.delete.useMutation({
    onSuccess: () => {
      setDeleteError(null);
      utils.clients.list.invalidate();
    },
    onError: (err) => setDeleteError(err.message),
  });

  const countryNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of countries.data ?? []) map.set(c.code, c.name);
    return map;
  }, [countries.data]);

  return (
    <ScreenShell
      title="Clients"
      actions={
        <Link href="/admin/clients/new" className="btn btn-primary">
          + Add new client
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
                  <th>Legal name</th>
                  <th>Trading name</th>
                  <th>UEN</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((client) => (
                  <tr key={client.id}>
                    <td>{client.legalName}</td>
                    <td>{client.tradingName ?? '—'}</td>
                    <td>
                      <code>{client.uen}</code>
                    </td>
                    <td>
                      {countryNameByCode.get(client.countryOfIncorporation) ??
                        client.countryOfIncorporation}
                    </td>
                    <td>
                      <span
                        className={
                          client.status === 'ACTIVE'
                            ? 'pill pill-success'
                            : client.status === 'DRAFT'
                              ? 'pill pill-muted'
                              : 'pill pill-muted'
                        }
                      >
                        {client.status}
                      </span>
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/clients/${client.id}/policies`}
                          className="btn btn-ghost btn-sm"
                        >
                          Policies
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/imports`}
                          className="btn btn-ghost btn-sm"
                        >
                          Imports
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/employees`}
                          className="btn btn-ghost btn-sm"
                        >
                          Employees
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/claims`}
                          className="btn btn-ghost btn-sm"
                        >
                          Claims
                        </Link>
                        <Link
                          href={`/admin/clients/${client.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (
                              window.confirm(`Delete ${client.legalName}? This cannot be undone.`)
                            ) {
                              remove.mutate({ id: client.id });
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
            message="No clients yet."
            actionHref="/admin/clients/new"
            actionLabel="+ Add your first client"
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
