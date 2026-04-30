// =============================================================
// Pools list + inline create form.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { type MemberRow, MemberRows } from './member-rows';

type FormState = {
  name: string;
  description: string;
  members: MemberRow[];
};

const emptyForm: FormState = {
  name: '',
  description: '',
  members: [],
};

export function PoolsScreen() {
  const utils = trpc.useUtils();
  const pools = trpc.pools.list.useQuery();
  const insurers = trpc.insurers.list.useQuery();
  const create = trpc.pools.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.pools.list.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.pools.delete.useMutation({
    onSuccess: () => utils.pools.list.invalidate(),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const insurerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of insurers.data ?? []) map.set(i.id, i.name);
    return map;
  }, [insurers.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    create.mutate({
      name: form.name.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      members: form.members.filter((m) => m.insurerId !== ''),
    });
  };

  return (
    <ScreenShell title="Pools">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-4">New pool</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="pool-name">
                Name
              </label>
              <input
                id="pool-name"
                className="input"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Generali Pool — Captive"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pool-desc">
                Description
              </label>
              <textarea
                id="pool-desc"
                className="textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional. E.g. STM captive arrangement, 60/40 with Great Eastern."
              />
            </div>

            <fieldset className="fieldset">
              <legend>Members</legend>
              <MemberRows
                members={form.members}
                onChange={(next) => setForm({ ...form, members: next })}
                insurers={insurers.data}
                insurersLoading={insurers.isLoading}
              />
            </fieldset>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                {create.isPending ? 'Saving…' : 'Add pool'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Existing pools</h3>
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
          <div className="card card-padded text-center">
            <p className="mb-0">No pools yet.</p>
          </div>
        )}
      </section>
    </ScreenShell>
  );
}
