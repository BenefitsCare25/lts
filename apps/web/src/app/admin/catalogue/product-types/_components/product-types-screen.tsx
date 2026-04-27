// =============================================================
// Product Catalogue editor (Screen 0e — S12).
//
// "The most powerful screen" per v2 §5.5: edits here propagate to
// every client's product configuration on the next benefit year.
// We list existing types and link to a per-type editor; creation
// happens through the same form so the JSON layout stays in one
// place.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';

export function ProductTypesScreen() {
  const utils = trpc.useUtils();
  const list = trpc.productTypes.list.useQuery();
  const remove = trpc.productTypes.delete.useMutation({
    onSuccess: () => utils.productTypes.list.invalidate(),
    onError: (err) => window.alert(err.message),
  });

  return (
    <>
      <section className="section">
        <p className="eyebrow">Catalogue · Screen 0e</p>
        <h1>Product Catalogue</h1>
        <p style={{ maxWidth: '52ch' }}>
          Product types define the shape of every product instance and plan downstream. Each row
          carries two JSON Schemas (product fields + plan rows), a premium-calculation strategy
          code, and optional parsing rules + display templates.
        </p>
        <p className="field-help">
          Edits bump the type's version. Phase 1 mutates in place; immutable published versions
          arrive with the publish workflow (S28).
        </p>
      </section>

      <section className="section">
        <div className="row">
          <Link href="/admin/catalogue/product-types/new" className="btn btn-primary">
            + New product type
          </Link>
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Existing product types</h3>
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Premium strategy</th>
                  <th>Version</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((pt) => (
                  <tr key={pt.id}>
                    <td>
                      <code>{pt.code}</code>
                    </td>
                    <td>{pt.name}</td>
                    <td>
                      <code>{pt.premiumStrategy}</code>
                    </td>
                    <td>v{pt.version}</td>
                    <td>
                      <div className="row-end">
                        <Link
                          href={`/admin/catalogue/product-types/${pt.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete product type ${pt.code}?`)) {
                              remove.mutate({ id: pt.id });
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
            <p style={{ marginBottom: 0 }}>
              No product types yet. The 12 v2 catalogue defaults are seeded by Story S16 — for now,
              add types manually here.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
