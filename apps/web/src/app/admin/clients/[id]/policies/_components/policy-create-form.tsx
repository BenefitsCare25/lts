// Captures only the policy name; entities and rate-overrides are
// configured on the edit screen where the JSON gets the room it
// needs.

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function PolicyCreateForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const create = trpc.policies.create.useMutation({
    onSuccess: async (created) => {
      await utils.policies.listByClient.invalidate({ clientId });
      router.push(`/admin/clients/${clientId}/policies/${created.id}/edit`);
    },
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
    <ScreenShell title="New policy">
      <div className="card card-padded">
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
            <Link href={`/admin/clients/${clientId}/policies`} className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </ScreenShell>
  );
}
