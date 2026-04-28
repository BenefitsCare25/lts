// =============================================================
// Policies list + inline create form for one client (S14, Screen 2).
//
// Create takes only a policy name — entities are managed on the
// edit page where the rate-overrides JSON gets the room it needs.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

export function ClientPoliciesScreen({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const client = trpc.clients.byId.useQuery({ id: clientId });
  const list = trpc.policies.listByClient.useQuery({ clientId });

  const create = trpc.policies.create.useMutation({
    onSuccess: async () => {
      setName('');
      setFormError(null);
      await utils.policies.listByClient.invalidate({ clientId });
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.policies.delete.useMutation({
    onSuccess: () => utils.policies.listByClient.invalidate({ clientId }),
    onError: (err) => setFormError(err.message),
  });

  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    create.mutate({
      clientId,
      data: { name: name.trim(), entities: [] },
    });
  };

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href="/admin/clients">← Clients</Link>
          {client.data ? <> · {client.data.legalName}</> : null}
        </p>
        <h1>Policies</h1>
        <p style={{ maxWidth: '60ch' }}>
          One client can hold multiple policies (e.g. a master employee benefits policy plus a
          standalone travel policy). Each policy carries one or more entities — usually a single
          row, but multi-entity groups (like STMicroelectronics' three legal entities under one
          master policy) belong here too.
        </p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '1rem' }}>Add policy</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="pol-name">
                Policy name
              </label>
              <input
                id="pol-name"
                className="input"
                type="text"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Master Employee Benefits 2026"
              />
              <span className="field-help">
                Add the policy name first; configure entities and rate overrides on the next screen.
              </span>
            </div>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={create.isPending || name.trim().length === 0}
              >
                {create.isPending ? 'Saving…' : 'Add policy'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Existing policies</h3>
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
          <div className="card card-padded" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 0 }}>No policies yet for this client.</p>
          </div>
        )}
      </section>
    </>
  );
}
