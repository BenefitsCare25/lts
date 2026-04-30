// =============================================================
// ProductsScreen — Screen 3 (S15) product picker for one BenefitYear.
//
// Add form: pick ProductType first, then the Insurer dropdown
// auto-filters to insurers whose `productsSupported` array
// contains the chosen product type's code. Pool and TPA are
// optional refinements; both are filtered to the tenant's
// active registry rows. Server validates again on save.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type FormState = {
  productTypeId: string;
  insurerId: string;
  poolId: string;
  tpaId: string;
};

const emptyForm: FormState = {
  productTypeId: '',
  insurerId: '',
  poolId: '',
  tpaId: '',
};

export function ProductsScreen({
  clientId,
  policyId,
  benefitYearId,
}: {
  clientId: string;
  policyId: string;
  benefitYearId: string;
}) {
  const utils = trpc.useUtils();
  const list = trpc.products.listByBenefitYear.useQuery({ benefitYearId });
  const productTypes = trpc.productTypes.list.useQuery();
  const insurers = trpc.insurers.list.useQuery();
  const pools = trpc.pools.list.useQuery();
  const tpas = trpc.tpas.list.useQuery();

  const create = trpc.products.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.products.listByBenefitYear.invalidate({ benefitYearId });
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.products.delete.useMutation({
    onSuccess: () => utils.products.listByBenefitYear.invalidate({ benefitYearId }),
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProductType = useMemo(
    () => productTypes.data?.find((pt) => pt.id === form.productTypeId) ?? null,
    [productTypes.data, form.productTypeId],
  );

  // The headline filter: insurers whose productsSupported array contains
  // the chosen product type's code. Server enforces the same constraint.
  const eligibleInsurers = useMemo(() => {
    if (!selectedProductType || !insurers.data) return [];
    return insurers.data.filter(
      (ins) => ins.active && ins.productsSupported.includes(selectedProductType.code),
    );
  }, [insurers.data, selectedProductType]);

  // If the user changes ProductType after picking an insurer, clear the
  // insurer if it no longer supports the new type.
  const onProductTypeChange = (productTypeId: string) => {
    const pt = productTypes.data?.find((p) => p.id === productTypeId);
    setForm((prev) => {
      const stillEligible =
        pt &&
        insurers.data?.find(
          (ins) => ins.id === prev.insurerId && ins.productsSupported.includes(pt.code),
        );
      return {
        ...prev,
        productTypeId,
        insurerId: stillEligible ? prev.insurerId : '',
      };
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    create.mutate({
      benefitYearId,
      productTypeId: form.productTypeId,
      insurerId: form.insurerId,
      poolId: form.poolId || null,
      tpaId: form.tpaId || null,
    });
  };

  const benefitYearState = list.data?.benefitYearState ?? null;
  const editable = benefitYearState === 'DRAFT';

  return (
    <>
      <section className="section">
        {benefitYearState ? (
          <p className="eyebrow mb-2">Benefit year ({benefitYearState})</p>
        ) : null}
        <h1>Products</h1>
        <p style={{ maxWidth: '60ch' }}>
          Pick the product types this benefit year covers. The insurer dropdown filters by which
          insurers support the chosen product type — set up new pairings in the insurer registry
          first if your insurer is missing.
        </p>
      </section>

      {editable ? (
        <section className="section">
          <div className="card card-padded">
            <h3 style={{ marginBottom: '1rem' }}>Add product</h3>
            <form onSubmit={submit} className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="prd-type">
                  Product type
                </label>
                <select
                  id="prd-type"
                  className="input"
                  required
                  value={form.productTypeId}
                  onChange={(e) => onProductTypeChange(e.target.value)}
                  disabled={productTypes.isLoading}
                >
                  <option value="">— Select product type —</option>
                  {productTypes.data?.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.code} · {pt.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="prd-insurer">
                  Insurer
                </label>
                <select
                  id="prd-insurer"
                  className="input"
                  required
                  value={form.insurerId}
                  onChange={(e) => setForm({ ...form, insurerId: e.target.value })}
                  disabled={!selectedProductType || insurers.isLoading}
                >
                  <option value="">
                    {selectedProductType
                      ? eligibleInsurers.length === 0
                        ? `— No insurers support ${selectedProductType.code} —`
                        : '— Select insurer —'
                      : '— Pick a product type first —'}
                  </option>
                  {eligibleInsurers.map((ins) => (
                    <option key={ins.id} value={ins.id}>
                      {ins.name} ({ins.code})
                    </option>
                  ))}
                </select>
                {selectedProductType ? (
                  <span className="field-help">
                    Showing {eligibleInsurers.length} insurer
                    {eligibleInsurers.length === 1 ? '' : 's'} supporting {selectedProductType.code}
                    .
                  </span>
                ) : null}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="prd-pool">
                  Pool <span className="field-help-inline">(optional)</span>
                </label>
                <select
                  id="prd-pool"
                  className="input"
                  value={form.poolId}
                  onChange={(e) => setForm({ ...form, poolId: e.target.value })}
                  disabled={pools.isLoading}
                >
                  <option value="">— None —</option>
                  {pools.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="prd-tpa">
                  TPA <span className="field-help-inline">(optional)</span>
                </label>
                <select
                  id="prd-tpa"
                  className="input"
                  value={form.tpaId}
                  onChange={(e) => setForm({ ...form, tpaId: e.target.value })}
                  disabled={tpas.isLoading}
                >
                  <option value="">— None —</option>
                  {tpas.data
                    ?.filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                </select>
              </div>

              {formError ? <p className="field-error">{formError}</p> : null}

              <div className="row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={create.isPending || !form.productTypeId || !form.insurerId}
                >
                  {create.isPending ? 'Saving…' : 'Add product'}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="card card-padded">
            <p style={{ marginBottom: 0 }}>
              {benefitYearState === 'PUBLISHED'
                ? 'This benefit year is published — products are locked. Add a new draft year to make changes.'
                : 'This benefit year is archived — read-only.'}
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Selected products</h3>
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.items.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product type</th>
                  <th>Insurer</th>
                  <th>Pool</th>
                  <th>TPA</th>
                  <th>Plans</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code>{p.productType.code}</code> · {p.productType.name}
                    </td>
                    <td>
                      {p.insurer ? `${p.insurer.name} (${p.insurer.code})` : '— deleted insurer —'}
                    </td>
                    <td>{p.pool?.name ?? '—'}</td>
                    <td>{p.tpa ? `${p.tpa.name} (${p.tpa.code})` : '—'}</td>
                    <td>{p._count.plans}</td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${p.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Configure
                        </Link>
                        {editable ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove ${p.productType.code} from this benefit year?`,
                                )
                              ) {
                                remove.mutate({ id: p.id });
                              }
                            }}
                            disabled={remove.isPending}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-padded" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 0 }}>
              {editable
                ? 'No products yet — pick one from the catalogue above.'
                : 'No products in this benefit year.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
