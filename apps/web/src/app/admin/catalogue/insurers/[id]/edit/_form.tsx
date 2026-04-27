// =============================================================
// Insurer edit form — same field set as the create form on the
// list page, separated only because we need the insurer's id and
// initial data to populate the controls.
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
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type FormState = {
  name: string;
  code: string;
  productsSupported: ProductTypeCode[];
  claimFeedProtocol: ClaimFeedProtocol | '';
  active: boolean;
};

export function EditInsurerForm({ insurerId }: { insurerId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const insurer = trpc.insurers.byId.useQuery({ id: insurerId });
  const update = trpc.insurers.update.useMutation({
    onSuccess: async () => {
      await utils.insurers.list.invalidate();
      await utils.insurers.byId.invalidate({ id: insurerId });
      router.push('/admin/catalogue/insurers');
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!insurer.data || form !== null) return;
    setForm({
      name: insurer.data.name,
      code: insurer.data.code,
      productsSupported: insurer.data.productsSupported as ProductTypeCode[],
      claimFeedProtocol: (insurer.data.claimFeedProtocol as ClaimFeedProtocol | null) ?? '',
      active: insurer.data.active,
    });
  }, [insurer.data, form]);

  if (insurer.isLoading || form === null) return <p>Loading…</p>;
  if (insurer.error)
    return <p style={{ color: '#b91c1c' }}>Failed to load: {insurer.error.message}</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    update.mutate({
      id: insurerId,
      data: {
        name: form.name.trim(),
        code: form.code.trim(),
        productsSupported: form.productsSupported,
        claimFeedProtocol: form.claimFeedProtocol === '' ? null : form.claimFeedProtocol,
        active: form.active,
      },
    });
  };

  const toggleProduct = (code: ProductTypeCode) => {
    setForm((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            productsSupported: prev.productsSupported.includes(code)
              ? prev.productsSupported.filter((c) => c !== code)
              : [...prev.productsSupported, code],
          },
    );
  };

  return (
    <section>
      <p>
        <Link href="/admin/catalogue/insurers">← Back to insurers</Link>
      </p>
      <h1>Edit insurer</h1>

      <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
        <label>
          <div>Name</div>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            pattern="^[A-Z][A-Z0-9_]*$"
            style={{ width: '100%' }}
          />
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

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={update.isPending || form.productsSupported.length === 0}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <Link href="/admin/catalogue/insurers">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
