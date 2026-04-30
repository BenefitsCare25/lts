'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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

export function PoolCreateForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const insurers = trpc.insurers.list.useQuery();
  const create = trpc.pools.create.useMutation({
    onSuccess: async () => {
      await utils.pools.list.invalidate();
      router.push('/admin/catalogue/pools');
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

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
    <ScreenShell title="New pool">
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
              Description <span className="field-help-inline">(optional)</span>
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
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Add pool'}
            </button>
            <Link href="/admin/catalogue/pools" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </ScreenShell>
  );
}
