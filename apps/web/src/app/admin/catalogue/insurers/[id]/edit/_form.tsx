// =============================================================
// Insurer edit form — same field set as the create form on the
// list page, separated only because we need the insurer's id and
// initial data to populate the controls.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import {
  PRODUCT_TYPE_CODES,
  type ProductTypeCode,
  REGISTRY_CODE_PATTERN,
} from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type FormState = {
  name: string;
  code: string;
  productsSupported: ProductTypeCode[];
  claimFeedProtocol: string;
  active: boolean;
};

export function EditInsurerForm({ insurerId }: { insurerId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const insurer = trpc.insurers.byId.useQuery({ id: insurerId });
  const update = trpc.insurers.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.insurers.list.invalidate(),
        utils.insurers.byId.invalidate({ id: insurerId }),
      ]);
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
      claimFeedProtocol: insurer.data.claimFeedProtocol ?? '',
      active: insurer.data.active,
    });
  }, [insurer.data, form]);

  if (insurer.isLoading || form === null) return <p>Loading…</p>;
  if (insurer.error) return <p className="field-error">Failed to load: {insurer.error.message}</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    update.mutate({
      id: insurerId,
      data: {
        name: form.name.trim(),
        code: form.code.trim(),
        productsSupported: form.productsSupported,
        claimFeedProtocol: form.claimFeedProtocol.trim() || null,
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
    <ScreenShell title="Edit insurer">
      <section className="section">
        <div className="card card-padded">
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
                pattern={REGISTRY_CODE_PATTERN}
              />
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
              />
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
                disabled={update.isPending || form.productsSupported.length === 0}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <Link href="/admin/catalogue/insurers" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>
    </ScreenShell>
  );
}
