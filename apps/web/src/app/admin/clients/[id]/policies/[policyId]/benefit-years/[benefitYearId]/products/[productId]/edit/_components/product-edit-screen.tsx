// =============================================================
// ProductEditScreen — sub-tab host for one product instance.
//
// Tabs:
//   Details     — form rendered from ProductType.schema via @rjsf/core
//   Plans       — repeating row table from planSchema; placeholder for now
//   Eligibility — groups × plans matrix; placeholder for now
//   Premium     — strategy-specific calc inputs; placeholder for now
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';
import { ProductDetailsTab } from './product-details-tab';
import { ProductEligibilityTab } from './product-eligibility-tab';
import { ProductPlansTab } from './product-plans-tab';
import { ProductPremiumTab } from './product-premium-tab';

type Tab = 'details' | 'plans' | 'eligibility' | 'premium';

const TABS: { id: Tab; label: string; available: boolean }[] = [
  { id: 'details', label: 'Details', available: true },
  { id: 'plans', label: 'Plans', available: true },
  { id: 'eligibility', label: 'Eligibility', available: true },
  { id: 'premium', label: 'Premium', available: true },
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
    <ScreenShell
      title={
        <>
          <code>{product.data.productType.code}</code> · {product.data.productType.name}
        </>
      }
      context={
        <>
          {product.data.insurer ? `${product.data.insurer.name} · ` : ''}
          Benefit year {product.data.benefitYear.state} · v{product.data.versionId}
        </>
      }
    >
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
      ) : tab === 'eligibility' ? (
        <ProductEligibilityTab clientId={clientId} policyId={policyId} productId={productId} />
      ) : tab === 'premium' ? (
        <ProductPremiumTab productId={productId} />
      ) : null}
    </ScreenShell>
  );
}
