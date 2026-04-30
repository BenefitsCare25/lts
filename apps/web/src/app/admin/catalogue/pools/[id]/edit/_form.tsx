// =============================================================
// Pool edit form. The repeating-row member control comes from the
// shared component used by the create form on the list page.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type MemberRow, MemberRows } from '../../_components/member-rows';

type FormState = {
  name: string;
  description: string;
  members: MemberRow[];
};

export function EditPoolForm({ poolId }: { poolId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const pool = trpc.pools.byId.useQuery({ id: poolId });
  const insurers = trpc.insurers.list.useQuery();
  const update = trpc.pools.update.useMutation({
    onSuccess: async () => {
      await utils.pools.list.invalidate();
      await utils.pools.byId.invalidate({ id: poolId });
      router.push('/admin/catalogue/pools');
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!pool.data || form !== null) return;
    setForm({
      name: pool.data.name,
      description: pool.data.description ?? '',
      members: pool.data.members.map((m) => ({
        insurerId: m.insurerId,
        shareBps: m.shareBps,
      })),
    });
  }, [pool.data, form]);

  if (pool.isLoading || form === null) return <p>Loading…</p>;
  if (pool.error) return <p className="field-error">Failed to load: {pool.error.message}</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    update.mutate({
      id: poolId,
      data: {
        name: form.name.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
        members: form.members.filter((m) => m.insurerId !== ''),
      },
    });
  };

  return (
    <>
      <section className="section">
        <h1>Edit pool</h1>
      </section>

      <section className="section">
        <div className="card card-padded">
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
              <button type="submit" className="btn btn-primary" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <Link href="/admin/catalogue/pools" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
