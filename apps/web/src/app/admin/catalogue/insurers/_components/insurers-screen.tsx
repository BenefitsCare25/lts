// =============================================================
// Insurers list + inline create form (Screen 0b — S8).
//
// Pattern is repeated by the next three registry stories
// (TPA / Pool / Product Catalogue), so the form helpers live
// in this file rather than abstracted prematurely. The next
// registry can copy this directory and rename.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import {
  CLAIM_FEED_PROTOCOLS,
  type ClaimFeedProtocol,
  PRODUCT_TYPE_CODES,
  type ProductTypeCode,
} from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useState } from 'react';

type FormState = {
  name: string;
  code: string;
  productsSupported: ProductTypeCode[];
  claimFeedProtocol: ClaimFeedProtocol | '';
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
      claimFeedProtocol: form.claimFeedProtocol === '' ? null : form.claimFeedProtocol,
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
    <section>
      <h1>Insurer Registry</h1>
      <p>
        Insurers known to this tenant. Used by Screen 3 (product selection) to filter the insurer
        dropdown by product type, and by the parser registry to route placement slips.
      </p>

      <h2>Add insurer</h2>
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
        <label>
          <div>Name</div>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Tokio Marine Life Insurance Singapore"
            style={{ width: '100%' }}
          />
        </label>

        <label>
          <div>Code</div>
          <input
            type="text"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="TM_LIFE"
            pattern="^[A-Z][A-Z0-9_]*$"
            style={{ width: '100%' }}
          />
          <small>Uppercase letters, digits, underscores. Unique per tenant.</small>
        </label>

        <fieldset style={{ border: '1px solid #ccc', padding: '0.5rem' }}>
          <legend>Products supported</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {PRODUCT_TYPE_CODES.map((code) => (
              <label key={code} style={{ display: 'inline-flex', gap: '0.25rem' }}>
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

        <label>
          <div>Claim feed protocol</div>
          <select
            value={form.claimFeedProtocol}
            onChange={(e) =>
              setForm({ ...form, claimFeedProtocol: e.target.value as ClaimFeedProtocol | '' })
            }
          >
            <option value="">— None —</option>
            {CLAIM_FEED_PROTOCOLS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>

        {formError ? <p style={{ color: '#b91c1c' }}>{formError}</p> : null}

        <button
          type="submit"
          disabled={create.isPending || form.productsSupported.length === 0}
          style={{ justifySelf: 'start' }}
        >
          {create.isPending ? 'Saving…' : 'Add insurer'}
        </button>
      </form>

      <h2 style={{ marginTop: '2rem' }}>Existing insurers</h2>
      {list.isLoading ? (
        <p>Loading…</p>
      ) : list.error ? (
        <p style={{ color: '#b91c1c' }}>Failed to load: {list.error.message}</p>
      ) : list.data && list.data.length > 0 ? (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Code</th>
              <th style={th}>Products</th>
              <th style={th}>Claim feed</th>
              <th style={th}>Active</th>
              <th style={th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.data.map((insurer) => (
              <tr key={insurer.id}>
                <td style={td}>{insurer.name}</td>
                <td style={td}>
                  <code>{insurer.code}</code>
                </td>
                <td style={td}>{insurer.productsSupported.join(', ') || '—'}</td>
                <td style={td}>{insurer.claimFeedProtocol ?? '—'}</td>
                <td style={td}>{insurer.active ? 'Yes' : 'No'}</td>
                <td style={td}>
                  <Link href={`/admin/catalogue/insurers/${insurer.id}/edit`}>Edit</Link>{' '}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete ${insurer.name}? This cannot be undone.`)) {
                        remove.mutate({ id: insurer.id });
                      }
                    }}
                    disabled={remove.isPending}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No insurers yet.</p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
  padding: '0.5rem',
};
const td: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: '0.5rem',
  verticalAlign: 'top',
};
