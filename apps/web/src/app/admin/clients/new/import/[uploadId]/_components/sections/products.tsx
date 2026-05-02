'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SectionId } from './_registry';
import {
  type WizardExtractedProduct,
  extractedProductsFromDraft,
  suggestionsFromDraft,
} from './_types';
import { DetailsTab } from './products/details-tab';
import { EndorsementsTab } from './products/endorsements-tab';
import { GroupsTab } from './products/groups-tab';
import { PlansTab } from './products/plans-tab';
import { RatesTab } from './products/rates-tab';
import type { ProductPatcher } from './products/shared';

type Props = {
  draft: { id: string; extractedProducts: unknown; progress: unknown };
  markSectionDirty?: (id: SectionId) => void;
};

type Tab = 'details' | 'plans' | 'rates' | 'groups' | 'endorsements';

// Empty product factory used by "+ Add product" — every field is the
// minimal valid envelope so downstream Apply doesn't trip on null
// checks. The broker fills in via the editable fields immediately.
const emptyProduct = (productTypeCode = 'GTL', insurerCode = ''): WizardExtractedProduct => ({
  productTypeCode,
  insurerCode,
  header: {
    policyNumber: { value: null, confidence: 0 },
    period: { value: null, confidence: 0 },
    lastEntryAge: { value: null, confidence: 0 },
    administrationType: { value: null, confidence: 0 },
    currency: { value: 'SGD', confidence: 0.3 },
    ageLimitNoUnderwriting: { value: null, confidence: 0 },
    aboveLastEntryAge: { value: null, confidence: 0 },
    employeeAgeLimit: { value: null, confidence: 0 },
    spouseAgeLimit: { value: null, confidence: 0 },
    childAgeLimit: { value: null, confidence: 0 },
    childMinimumAge: { value: null, confidence: 0 },
  },
  policyholder: {
    legalName: { value: null, confidence: 0 },
    uen: { value: null, confidence: 0 },
    address: { value: null, confidence: 0 },
    businessDescription: { value: null, confidence: 0 },
    insuredEntities: [],
  },
  eligibility: {
    freeText: { value: null, confidence: 0 },
    categories: [],
  },
  plans: [],
  premiumRates: [],
  benefits: [],
  extractionMeta: {
    overallConfidence: 0.5,
    extractorVersion: 'broker-manual',
    warnings: [],
  },
});

function TabButton({
  id,
  label,
  active,
  onChange,
}: {
  id: Tab;
  label: string;
  active: Tab;
  onChange: (id: Tab) => void;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      style={{
        padding: '0.5rem 1rem',
        background: 'none',
        border: 'none',
        borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 400,
        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  );
}

export function ProductsSection({ draft, markSectionDirty }: Props) {
  // Local mirror of the products list. Re-seeded only when draft.id
  // changes; subsequent refetches don't clobber in-flight edits.
  const [products, setProducts] = useState<WizardExtractedProduct[]>(() =>
    extractedProductsFromDraft(draft.extractedProducts),
  );
  const seededDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededDraftIdRef.current === draft.id) return;
    seededDraftIdRef.current = draft.id;
    setProducts(extractedProductsFromDraft(draft.extractedProducts));
  }, [draft.id, draft.extractedProducts]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const active = products[activeIndex] ?? null;

  const saveProducts = trpc.extractionDrafts.updateExtractedProducts.useMutation();
  const markAutosaveDirty = useDebouncedAutosave(
    products,
    (value) =>
      saveProducts.mutate({
        draftId: draft.id,
        extractedProducts: value as unknown as Array<{
          productTypeCode: string;
          insurerCode: string;
        }>,
      }),
    { delayMs: 700 },
  );

  const markProductsDirty = useCallback(() => {
    markAutosaveDirty();
    markSectionDirty?.('products');
  }, [markAutosaveDirty, markSectionDirty]);

  const updateProduct = useCallback(
    (index: number, patch: (p: WizardExtractedProduct) => WizardExtractedProduct) => {
      markProductsDirty();
      setProducts((prev) => prev.map((p, i) => (i === index ? patch(p) : p)));
    },
    [markProductsDirty],
  );

  const addProduct = () => {
    markProductsDirty();
    setProducts((prev) => {
      setActiveIndex(prev.length);
      return [...prev, emptyProduct()];
    });
    setActiveTab('details');
  };

  const removeProduct = (index: number) => {
    if (
      !window.confirm(
        `Remove product "${products[index]?.productTypeCode}·${products[index]?.insurerCode}" from the draft?`,
      )
    ) {
      return;
    }
    markProductsDirty();
    setProducts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (activeIndex >= next.length) setActiveIndex(Math.max(0, next.length - 1));
      return next;
    });
  };

  const makeOnChange = useCallback(
    (index: number): ProductPatcher =>
      (patch) =>
        updateProduct(index, patch),
    [updateProduct],
  );

  if (products.length === 0) {
    return (
      <>
        <h2>Products</h2>
        <section className="section">
          <Card className="card-padded">
            <p className="mb-2">
              <strong>No products in the catalogue yet.</strong>
            </p>
            <p className="field-help mb-3">
              The slip-level details (client, entities, benefit year, insurers) are populated, but
              every per-product extraction pass failed or no template matched. Re-run AI extraction
              from the Source section to retry, or add a product manually below.
            </p>
            <button type="button" className="btn btn-primary" onClick={addProduct}>
              + Add product manually
            </button>
          </Card>
        </section>
      </>
    );
  }

  return (
    <>
      <h2>Products ({products.length})</h2>

      <section className="section">
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {products.map((p, i) => (
            <button
              key={`${p.productTypeCode}-${p.insurerCode}-${i}`}
              type="button"
              className={i === activeIndex ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => {
                setActiveIndex(i);
                setActiveTab('details');
              }}
            >
              <code>{p.productTypeCode}</code> · {p.insurerCode || <em>—</em>}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addProduct}>
            + Add product
          </button>
        </div>
      </section>

      {active ? (
        <>
          <section className="section">
            <div className="row" style={{ borderBottom: '1px solid var(--border)' }}>
              <TabButton id="details" label="Details" active={activeTab} onChange={setActiveTab} />
              <TabButton
                id="plans"
                label={`Plans (${active.plans.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="rates"
                label={`Rates (${active.premiumRates.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="groups"
                label={`Groups (${suggestionsFromDraft(draft.progress).benefitGroups.length})`}
                active={activeTab}
                onChange={setActiveTab}
              />
              <TabButton
                id="endorsements"
                label="Endorsements"
                active={activeTab}
                onChange={setActiveTab}
              />
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                style={{ marginBottom: '0.25rem' }}
                onClick={() => removeProduct(activeIndex)}
              >
                Remove product
              </button>
            </div>
          </section>

          {activeTab === 'details' ? (
            <DetailsTab product={active} onChange={makeOnChange(activeIndex)} />
          ) : null}
          {activeTab === 'plans' ? (
            <PlansTab product={active} onChange={makeOnChange(activeIndex)} />
          ) : null}
          {activeTab === 'rates' ? (
            <RatesTab product={active} onChange={makeOnChange(activeIndex)} />
          ) : null}
          {activeTab === 'groups' ? <GroupsTab product={active} draft={draft} /> : null}
          {activeTab === 'endorsements' ? (
            <EndorsementsTab product={active} onChange={makeOnChange(activeIndex)} />
          ) : null}

          {saveProducts.isPending ? (
            <p className="field-help text-muted" style={{ textAlign: 'right' }}>
              Saving…
            </p>
          ) : saveProducts.isSuccess ? (
            <p className="field-help text-good" style={{ textAlign: 'right' }}>
              ✓ Saved
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
