// =============================================================
// TPAs list + inline create form.
//
// supportedInsurerIds is rendered as a chip-style multi-select
// pulling from the existing Insurer Registry. If no insurers exist
// yet, we surface a hint pointing the admin at /admin/catalogue/insurers
// rather than show an empty checkbox group.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { TPA_FEED_FORMATS, type TpaFeedFormat } from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useMemo, useState } from 'react';

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

export function TpasScreen() {
  const utils = trpc.useUtils();
  const tpas = trpc.tpas.list.useQuery();
  const insurers = trpc.insurers.list.useQuery();
  const create = trpc.tpas.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.tpas.list.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.tpas.delete.useMutation({
    onSuccess: () => utils.tpas.list.invalidate(),
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
    <ScreenShell title="TPAs">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-4">New TPA</h3>
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
                placeholder="Integrated Health Plans"
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
                placeholder="IHP"
                pattern="^[A-Z][A-Z0-9_]*$"
              />
              <span className="field-help">
                Uppercase letters, digits, underscores. Unique per tenant.
              </span>
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
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                {create.isPending ? 'Saving…' : 'Add TPA'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Existing TPAs</h3>
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
          <div className="card card-padded text-center">
            <p className="mb-0">No TPAs yet.</p>
          </div>
        )}
      </section>
    </ScreenShell>
  );
}
