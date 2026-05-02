// =============================================================
// ProductDetailsTab — Screen 5a.
//
// Renders an @rjsf/core form from `ProductType.schema`, prefilled
// from `Product.data`. Submit posts to `products.updateData`,
// which re-validates server-side via Ajv. Form is read-only when
// the parent BenefitYear is not DRAFT (PUBLISHED/ARCHIVED → locked).
// =============================================================

'use client';

import { RjsfForm as Form } from '@/components/ui/rjsf-form';
import { trpc } from '@/lib/trpc/client';
import type { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useState } from 'react';

export function ProductDetailsTab({
  productId,
  editable,
}: {
  productId: string;
  editable: boolean;
}) {
  const utils = trpc.useUtils();
  const product = trpc.products.byId.useQuery({ id: productId });
  const updateData = trpc.products.updateData.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      setSaved(true);
      await utils.products.byId.invalidate({ id: productId });
    },
    onError: (err) => {
      setSaveError(err.message);
      setSaved(false);
    },
  });

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (product.isLoading) return <p>Loading…</p>;
  if (product.error) return <p className="field-error">Failed to load: {product.error.message}</p>;
  if (!product.data) return null;

  const schema = product.data.productType.schema as RJSFSchema;
  const formData = product.data.data as Record<string, unknown>;

  return (
    <section className="section">
      <div className="card card-padded">
        <h3 className="mb-2">Details</h3>
        <p className="field-help" style={{ marginBottom: '1rem' }}>
          Fields below are generated from the {product.data.productType.code} schema in the product
          catalogue. Edits here apply to this benefit year only — to change the schema for every
          client, edit <a href="/admin/catalogue/product-types">Product Types</a>.
        </p>

        {!editable ? (
          <div className="card card-padded" style={{ background: 'var(--bg-soft, #f8fafc)' }}>
            <strong>Read-only.</strong> This benefit year is{' '}
            {product.data.benefitYear.state.toLowerCase()} — product details are locked.
          </div>
        ) : null}

        <Form
          schema={schema}
          formData={formData}
          validator={validator}
          disabled={!editable || updateData.isPending}
          // We supply our own submit button below to align with the rest
          // of the admin's button styling. Hide @rjsf's default one.
          uiSchema={{ 'ui:submitButtonOptions': { norender: true } }}
          onChange={() => {
            if (saved) setSaved(false);
            if (saveError) setSaveError(null);
          }}
          onSubmit={({ formData: submitted }) => {
            updateData.mutate({
              id: productId,
              data: (submitted ?? {}) as Record<string, unknown>,
            });
          }}
          showErrorList="bottom"
        >
          {saveError ? <p className="field-error">{saveError}</p> : null}
          {saved ? <p className="field-help text-good">✓ Saved.</p> : null}
          {editable ? (
            <div className="row" style={{ marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={updateData.isPending}>
                {updateData.isPending ? 'Saving…' : 'Save details'}
              </button>
            </div>
          ) : null}
        </Form>
      </div>
    </section>
  );
}
