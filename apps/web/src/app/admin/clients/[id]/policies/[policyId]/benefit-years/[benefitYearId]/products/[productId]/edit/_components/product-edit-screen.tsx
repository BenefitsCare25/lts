// =============================================================
// ProductEditScreen — sub-tab host for one product instance.
//
// Tabs:
//   Details (S21)     — form rendered from ProductType.schema via @rjsf/core
//   Plans (S22)       — repeating row table from planSchema; placeholder for now
//   Eligibility (S23) — groups × plans matrix; placeholder for now
//   Premium (S24)     — strategy-specific calc inputs; placeholder for now
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';
import { ProductDetailsTab } from './product-details-tab';
import { ProductPlansTab } from './product-plans-tab';

type Tab = 'details' | 'plans' | 'eligibility' | 'premium';

const TABS: { id: Tab; label: string; available: boolean }[] = [
  { id: 'details', label: 'Details', available: true },
  { id: 'plans', label: 'Plans', available: true },
  { id: 'eligibility', label: 'Eligibility', available: false },
  { id: 'premium', label: 'Premium', available: false },
];

export function ProductEditScreen({
  clientId,
  policyId,
  benefitYearId,
  productId,
}: {
  clientId: string;
  policyId: string;
  benefitYearId: string;
  productId: string;
}) {
  const product = trpc.products.byId.useQuery({ id: productId });
  const [tab, setTab] = useState<Tab>('details');

  if (product.isLoading) return <p>Loading…</p>;
  if (product.error) return <p className="field-error">Failed to load: {product.error.message}</p>;
  if (!product.data) return null;

  const editable = product.data.benefitYear.state === 'DRAFT';

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link
            href={`/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products`}
          >
            ← Products
          </Link>
        </p>
        <h1>
          <code>{product.data.productType.code}</code> · {product.data.productType.name}
        </h1>
        <p className="field-help">
          {product.data.insurer ? `${product.data.insurer.name} · ` : ''}
          Benefit year {product.data.benefitYear.state} · v{product.data.versionId}
        </p>
      </section>

      <section className="section">
        <div className="row" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => t.available && setTab(t.id)}
              disabled={!t.available}
              title={t.available ? undefined : 'Coming in a later story'}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {tab === 'details' ? (
        <ProductDetailsTab productId={productId} editable={editable} />
      ) : tab === 'plans' ? (
        <ProductPlansTab
          clientId={clientId}
          policyId={policyId}
          benefitYearId={benefitYearId}
          productId={productId}
          editable={editable}
        />
      ) : (
        <section className="section">
          <p className="field-help">This sub-tab lands in a later story.</p>
        </section>
      )}
    </>
  );
}
