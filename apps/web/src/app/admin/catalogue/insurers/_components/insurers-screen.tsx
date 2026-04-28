// =============================================================
// Insurers list + inline create form (Screen 0b — S8).
//
// Pattern is reused by the next registry stories (TPA / Pool /
// Product Catalogue). The form helpers live in this file rather
// than abstracted prematurely; the next registry can copy this
// directory and rename.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import { PRODUCT_TYPE_CODES, type ProductTypeCode } from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useState } from 'react';

type FormState = {
  name: string;
  code: string;
  productsSupported: ProductTypeCode[];
  claimFeedProtocol: string;
  active: boolean;
};

const emptyForm: FormState = {
  name: '',
  code: '',
  productsSupported: [],
  claimFeedProtocol: '',
  active: true,
};

export function InsurersScreen() {
  const utils = trpc.useUtils();
  const list = trpc.insurers.list.useQuery();
  const create = trpc.insurers.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.insurers.list.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.insurers.delete.useMutation({
    onSuccess: () => utils.insurers.list.invalidate(),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    create.mutate({
      name: form.name.trim(),
      code: form.code.trim(),
      productsSupported: form.productsSupported,
      claimFeedProtocol: form.claimFeedProtocol.trim() || null,
      active: form.active,
    });
  };

  const toggleProduct = (code: ProductTypeCode) => {
    setForm((prev) => ({
      ...prev,
      productsSupported: prev.productsSupported.includes(code)
        ? prev.productsSupported.filter((c) => c !== code)
        : [...prev.productsSupported, code],
    }));
  };

  return (
    <>
      <section className="section">
        <p className="eyebrow">Catalogue · Screen 0b</p>
        <h1>Insurer Registry</h1>
        <p style={{ maxWidth: '52ch' }}>
          Insurers known to this tenant. Used by Screen 3 (product selection) to filter the insurer
          dropdown by product type, and by the parser registry to route placement slips.
        </p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '1rem' }}>Add insurer</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="ins-name">
                Name
              </label>
              <input
                id="ins-name"
                className="input"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Tokio Marine Life Insurance Singapore"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ins-code">
                Code
              </label>
              <input
                id="ins-code"
                className="input"
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="TM_LIFE"
                pattern="^[A-Z][A-Z0-9_]*$"
              />
              <span className="field-help">
                Uppercase letters, digits, underscores. Unique per tenant.
              </span>
            </div>

            <fieldset className="fieldset">
              <legend>Products supported</legend>
              <div className="chip-group">
                {PRODUCT_TYPE_CODES.map((code) => (
                  <label key={code} className="chip">
                    <input
                      type="checkbox"
                      checked={form.productsSupported.includes(code)}
                      onChange={() => toggleProduct(code)}
                    />
                    {code}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="field">
              <label className="field-label" htmlFor="ins-claim-feed">
                Claim feed protocol <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="ins-claim-feed"
                className="input"
                type="text"
                maxLength={40}
                value={form.claimFeedProtocol}
                onChange={(e) => setForm({ ...form, claimFeedProtocol: e.target.value })}
                placeholder="IHP"
              />
              <span className="field-help">
                Wire format the insurer's TPA delivers claims in (e.g. IHP, TMLS, DIRECT_API). The
                claims-feed router uses this to dispatch the right parser.
              </span>
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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={create.isPending || form.productsSupported.length === 0}
              >
                {create.isPending ? 'Saving…' : 'Add insurer'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Existing insurers</h3>
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
                  <th>Code</th>
                  <th>Products</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((insurer) => (
                  <tr key={insurer.id}>
                    <td>{insurer.name}</td>
                    <td>
                      <code>{insurer.code}</code>
                    </td>
                    <td>{insurer.productsSupported.join(', ') || '—'}</td>
                    <td>
                      <span className={insurer.active ? 'pill pill-success' : 'pill pill-muted'}>
                        {insurer.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/catalogue/insurers/${insurer.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${insurer.name}? This cannot be undone.`)) {
                              remove.mutate({ id: insurer.id });
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
            <p style={{ marginBottom: 0 }}>No insurers yet.</p>
          </div>
        )}
      </section>
    </>
  );
}
