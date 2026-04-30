'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import {
  PRODUCT_TYPE_CODES,
  type ProductTypeCode,
  REGISTRY_CODE_HELP,
  REGISTRY_CODE_PATTERN,
} from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export function InsurerCreateForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const create = trpc.insurers.create.useMutation({
    onSuccess: async () => {
      await utils.insurers.list.invalidate();
      router.push('/admin/catalogue/insurers');
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
    <ScreenShell title="New insurer">
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
            <span className="field-help">{REGISTRY_CODE_HELP}</span>
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
            <span className="field-help">
              Wire format the insurer&rsquo;s TPA delivers claims in. The claims-feed router uses
              this to dispatch the right parser.
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
            <Link href="/admin/catalogue/insurers" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </ScreenShell>
  );
}
