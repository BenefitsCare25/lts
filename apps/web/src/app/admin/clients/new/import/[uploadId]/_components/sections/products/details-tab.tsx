'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import type { FieldEnvelope, WizardExtractedProduct } from '../_types';
import type { ProductPatcher } from './shared';

// ── EditableFieldRow (used only in DetailsTab) ──────────────

function EditableFieldRow({
  label,
  value,
  onChange,
  confidence,
  sourceRef,
  inputType,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string } | undefined;
  inputType?: 'text' | 'number' | 'date' | undefined;
  multiline?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  const id = `fr-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {sourceRef ? (
          <ConfidenceBadge confidence={confidence} variant="dot" sourceRef={sourceRef} />
        ) : (
          <ConfidenceBadge confidence={confidence} variant="dot" />
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="input"
          value={value}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={inputType ?? 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {sourceRef?.sheet ? (
        <span className="field-help">
          Source: {sourceRef.sheet}
          {sourceRef.cell ? `!${sourceRef.cell}` : ''}
        </span>
      ) : null}
    </div>
  );
}

// ── DetailsTab ────────────────────────────────────────────────

export function DetailsTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  // Helper that updates a single header field, preserving its
  // confidence + sourceRef so the badge / hover keep working but the
  // value reflects the broker's edit.
  const setHeader = <K extends keyof WizardExtractedProduct['header']>(
    key: K,
    value: WizardExtractedProduct['header'][K]['value'],
  ) => {
    onChange((p) => ({
      ...p,
      header: {
        ...p.header,
        [key]: {
          ...p.header[key],
          value,
          // Broker edits become high-confidence — preserves the AI's
          // sourceRef but signals the value is no longer model-derived.
          confidence: 1,
        } as WizardExtractedProduct['header'][K],
      },
    }));
  };

  const setEligibilityText = (value: string | null) => {
    onChange((p) => ({
      ...p,
      eligibility: {
        ...p.eligibility,
        freeText: { ...p.eligibility.freeText, value, confidence: 1 },
      },
    }));
  };

  const setProductTypeCode = (value: string) => {
    onChange((p) => ({ ...p, productTypeCode: value.trim().toUpperCase() }));
  };
  const setInsurerCode = (value: string) => {
    onChange((p) => ({ ...p, insurerCode: value.trim().toUpperCase() }));
  };

  const tpasQuery = trpc.tpas.list.useQuery();
  const setTpaId = (tpaId: string | null) => {
    onChange((p) => ({ ...p, tpaId }));
  };

  const hasValue = (field: FieldEnvelope<unknown>) =>
    field.value != null || field.confidence > 0;

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Product details</h3>
        <div className="form-grid">
          <EditableFieldRow
            label="Product type"
            value={product.productTypeCode}
            onChange={setProductTypeCode}
            confidence={1}
          />
          <EditableFieldRow
            label="Insurer"
            value={product.insurerCode}
            onChange={setInsurerCode}
            confidence={1}
          />
          <EditableFieldRow
            label="Policy number"
            value={product.header.policyNumber.value ?? ''}
            onChange={(v) => setHeader('policyNumber', v.trim() || null)}
            confidence={product.header.policyNumber.confidence}
            sourceRef={product.header.policyNumber.sourceRef}
            placeholder="(unassigned — broker fills before apply)"
          />
          <EditableFieldRow
            label="Period start"
            value={product.header.period.value?.from ?? ''}
            onChange={(v) =>
              setHeader('period', {
                from: v.trim(),
                to: product.header.period.value?.to ?? '',
              })
            }
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
            inputType="date"
          />
          <EditableFieldRow
            label="Period end"
            value={product.header.period.value?.to ?? ''}
            onChange={(v) =>
              setHeader('period', {
                from: product.header.period.value?.from ?? '',
                to: v.trim(),
              })
            }
            confidence={product.header.period.confidence}
            sourceRef={product.header.period.sourceRef}
            inputType="date"
          />
          <EditableFieldRow
            label="Last entry age"
            value={product.header.lastEntryAge.value?.toString() ?? ''}
            onChange={(v) => {
              const n = Number.parseInt(v, 10);
              setHeader('lastEntryAge', Number.isFinite(n) ? n : null);
            }}
            confidence={product.header.lastEntryAge.confidence}
            sourceRef={product.header.lastEntryAge.sourceRef}
            inputType="number"
          />
          <EditableFieldRow
            label="Administration"
            value={product.header.administrationType.value ?? ''}
            onChange={(v) => setHeader('administrationType', v.trim() || null)}
            confidence={product.header.administrationType.confidence}
            sourceRef={product.header.administrationType.sourceRef}
            placeholder="e.g. Headcount basis, Named basis"
          />
          <EditableFieldRow
            label="Currency"
            value={product.header.currency.value ?? ''}
            onChange={(v) => setHeader('currency', v.trim().toUpperCase() || null)}
            confidence={product.header.currency.confidence}
            sourceRef={product.header.currency.sourceRef}
            placeholder="SGD"
          />
          <div className="field">
            <label className="field-label" htmlFor="product-tpa">
              TPA (optional)
            </label>
            <select
              id="product-tpa"
              className="input"
              value={product.tpaId ?? ''}
              onChange={(e) => setTpaId(e.target.value || null)}
              disabled={tpasQuery.isLoading}
            >
              <option value="">— no TPA —</option>
              {(tpasQuery.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code}){t.active ? '' : ' · inactive'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(hasValue(product.header.ageLimitNoUnderwriting) ||
          hasValue(product.header.aboveLastEntryAge) ||
          hasValue(product.header.employeeAgeLimit) ||
          hasValue(product.header.spouseAgeLimit) ||
          hasValue(product.header.childAgeLimit) ||
          hasValue(product.header.childMinimumAge)) && (
          <>
            <h3 className="mt-4 mb-3">Age limits</h3>
            <div className="form-grid">
              {hasValue(product.header.ageLimitNoUnderwriting) && (
                <EditableFieldRow
                  label="No underwriting limit (age)"
                  value={product.header.ageLimitNoUnderwriting.value?.toString() ?? ''}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    setHeader('ageLimitNoUnderwriting', Number.isFinite(n) ? n : null);
                  }}
                  confidence={product.header.ageLimitNoUnderwriting.confidence}
                  sourceRef={product.header.ageLimitNoUnderwriting.sourceRef}
                  inputType="number"
                  placeholder="e.g. 55"
                />
              )}
              {hasValue(product.header.aboveLastEntryAge) && (
                <EditableFieldRow
                  label="Above last entry age"
                  value={product.header.aboveLastEntryAge.value ?? ''}
                  onChange={(v) => setHeader('aboveLastEntryAge', v.trim() || null)}
                  confidence={product.header.aboveLastEntryAge.confidence}
                  sourceRef={product.header.aboveLastEntryAge.sourceRef}
                  placeholder="e.g. Provisional basis"
                />
              )}
              {hasValue(product.header.employeeAgeLimit) && (
                <EditableFieldRow
                  label="Employee age limit"
                  value={product.header.employeeAgeLimit.value?.toString() ?? ''}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    setHeader('employeeAgeLimit', Number.isFinite(n) ? n : null);
                  }}
                  confidence={product.header.employeeAgeLimit.confidence}
                  sourceRef={product.header.employeeAgeLimit.sourceRef}
                  inputType="number"
                  placeholder="e.g. 65"
                />
              )}
              {hasValue(product.header.spouseAgeLimit) && (
                <EditableFieldRow
                  label="Spouse age limit"
                  value={product.header.spouseAgeLimit.value?.toString() ?? ''}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    setHeader('spouseAgeLimit', Number.isFinite(n) ? n : null);
                  }}
                  confidence={product.header.spouseAgeLimit.confidence}
                  sourceRef={product.header.spouseAgeLimit.sourceRef}
                  inputType="number"
                  placeholder="e.g. 65"
                />
              )}
              {hasValue(product.header.childAgeLimit) && (
                <EditableFieldRow
                  label="Child age limit"
                  value={product.header.childAgeLimit.value?.toString() ?? ''}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    setHeader('childAgeLimit', Number.isFinite(n) ? n : null);
                  }}
                  confidence={product.header.childAgeLimit.confidence}
                  sourceRef={product.header.childAgeLimit.sourceRef}
                  inputType="number"
                  placeholder="e.g. 19"
                />
              )}
              {hasValue(product.header.childMinimumAge) && (
                <EditableFieldRow
                  label="Child minimum age"
                  value={product.header.childMinimumAge.value?.toString() ?? ''}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    setHeader('childMinimumAge', Number.isFinite(n) ? n : null);
                  }}
                  confidence={product.header.childMinimumAge.confidence}
                  sourceRef={product.header.childMinimumAge.sourceRef}
                  inputType="number"
                  placeholder="e.g. 0"
                />
              )}
            </div>
          </>
        )}

        <h3 className="mt-4 mb-3">Eligibility</h3>
        <EditableFieldRow
          label="Eligibility text"
          value={product.eligibility.freeText.value ?? ''}
          onChange={(v) => setEligibilityText(v.trim() || null)}
          confidence={product.eligibility.freeText.confidence}
          sourceRef={product.eligibility.freeText.sourceRef}
          multiline
        />
      </Card>
    </section>
  );
}
