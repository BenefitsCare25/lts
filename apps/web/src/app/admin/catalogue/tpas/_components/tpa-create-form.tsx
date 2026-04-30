'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import {
  REGISTRY_CODE_HELP,
  REGISTRY_CODE_PATTERN,
  TPA_FEED_FORMATS,
  type TpaFeedFormat,
} from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type FormState = {
  name: string;
  code: string;
  supportedInsurerIds: string[];
  feedFormat: TpaFeedFormat;
  active: boolean;
};

const emptyForm: FormState = {
  name: '',
  code: '',
  supportedInsurerIds: [],
  feedFormat: 'CSV_V1',
  active: true,
};

export function TpaCreateForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const insurers = trpc.insurers.list.useQuery();
  const create = trpc.tpas.create.useMutation({
    onSuccess: async () => {
      await utils.tpas.list.invalidate();
      router.push('/admin/catalogue/tpas');
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
      code: form.code.trim(),
      supportedInsurerIds: form.supportedInsurerIds,
      feedFormat: form.feedFormat,
      active: form.active,
    });
  };

  const toggleInsurer = (id: string) => {
    setForm((prev) => ({
      ...prev,
      supportedInsurerIds: prev.supportedInsurerIds.includes(id)
        ? prev.supportedInsurerIds.filter((x) => x !== id)
        : [...prev.supportedInsurerIds, id],
    }));
  };

  return (
    <ScreenShell title="New TPA">
      <div className="card card-padded">
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="tpa-name">
              Name
            </label>
            <input
              id="tpa-name"
              className="input"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tpa-code">
              Code
            </label>
            <input
              id="tpa-code"
              className="input"
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              pattern={REGISTRY_CODE_PATTERN}
            />
            <span className="field-help">{REGISTRY_CODE_HELP}</span>
          </div>

          <fieldset className="fieldset">
            <legend>Supported insurers</legend>
            {insurers.isLoading ? (
              <p className="m-0">
                <small>Loading insurers…</small>
              </p>
            ) : (insurers.data ?? []).length === 0 ? (
              <p className="m-0">
                <small>
                  No insurers exist yet.{' '}
                  <Link href="/admin/catalogue/insurers/new">Add one first</Link>.
                </small>
              </p>
            ) : (
              <div className="chip-group">
                {insurers.data?.map((insurer) => (
                  <label key={insurer.id} className="chip">
                    <input
                      type="checkbox"
                      checked={form.supportedInsurerIds.includes(insurer.id)}
                      onChange={() => toggleInsurer(insurer.id)}
                    />
                    {insurer.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="field">
            <label className="field-label" htmlFor="tpa-feed">
              Feed format
            </label>
            <select
              id="tpa-feed"
              className="select"
              value={form.feedFormat}
              onChange={(e) => setForm({ ...form, feedFormat: e.target.value as TpaFeedFormat })}
            >
              {TPA_FEED_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active
          </label>

          {formError ? <p className="field-error">{formError}</p> : null}

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Add TPA'}
            </button>
            <Link href="/admin/catalogue/tpas" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </ScreenShell>
  );
}
