// =============================================================
// TPA edit form — same field set as the create form on the list
// page. Fetches both the TPA being edited and the full insurer
// list so the multi-select can render the current selections.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import { TPA_FEED_FORMATS, type TpaFeedFormat } from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type FormState = {
  name: string;
  code: string;
  supportedInsurerIds: string[];
  feedFormat: TpaFeedFormat;
  active: boolean;
};

export function EditTpaForm({ tpaId }: { tpaId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const tpa = trpc.tpas.byId.useQuery({ id: tpaId });
  const insurers = trpc.insurers.list.useQuery();
  const update = trpc.tpas.update.useMutation({
    onSuccess: async () => {
      await utils.tpas.list.invalidate();
      await utils.tpas.byId.invalidate({ id: tpaId });
      router.push('/admin/catalogue/tpas');
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!tpa.data || form !== null) return;
    setForm({
      name: tpa.data.name,
      code: tpa.data.code,
      supportedInsurerIds: tpa.data.supportedInsurerIds,
      feedFormat: tpa.data.feedFormat as TpaFeedFormat,
      active: tpa.data.active,
    });
  }, [tpa.data, form]);

  if (tpa.isLoading || form === null) return <p>Loading…</p>;
  if (tpa.error) return <p className="field-error">Failed to load: {tpa.error.message}</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    update.mutate({
      id: tpaId,
      data: {
        name: form.name.trim(),
        code: form.code.trim(),
        supportedInsurerIds: form.supportedInsurerIds,
        feedFormat: form.feedFormat,
        active: form.active,
      },
    });
  };

  const toggleInsurer = (id: string) => {
    setForm((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            supportedInsurerIds: prev.supportedInsurerIds.includes(id)
              ? prev.supportedInsurerIds.filter((x) => x !== id)
              : [...prev.supportedInsurerIds, id],
          },
    );
  };

  return (
    <>
      <section className="section">
        <h1>Edit TPA</h1>
      </section>

      <section className="section">
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
                pattern="^[A-Z][A-Z0-9_]*$"
              />
            </div>

            <fieldset className="fieldset">
              <legend>Supported insurers</legend>
              {insurers.isLoading ? (
                <p style={{ margin: 0 }}>
                  <small>Loading insurers…</small>
                </p>
              ) : (insurers.data ?? []).length === 0 ? (
                <p style={{ margin: 0 }}>
                  <small>
                    No insurers exist yet.{' '}
                    <Link href="/admin/catalogue/insurers">Add one first</Link>.
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
              <button type="submit" className="btn btn-primary" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <Link href="/admin/catalogue/tpas" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
