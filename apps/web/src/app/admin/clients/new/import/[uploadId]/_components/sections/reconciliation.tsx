// =============================================================
// ReconciliationSection — per-product premium totals computed
// from the extracted rates vs the slip's declared totals.
//
// Editable:
//   - Declared total per product (broker overrides the AI/heuristic
//     if the source-cell extraction was wrong).
//   - Variance threshold (default 1%) — Apply step blocks when any
//     product breaches this (Phase 3 wiring).
//
// Persisted under draft.progress.brokerOverrides.reconciliation:
//   {
//     declaredOverrides: Record<`${productTypeCode}::${insurerCode}`, number | null>,
//     variancePctThreshold: number,  // e.g. 1 for 1%
//     acknowledged: boolean,         // broker tick-acknowledges variance
//   }
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionId } from './_registry';
import { suggestionsFromDraft } from './_types';

type Props = {
  draft: { id: string; progress: unknown };
  markSectionDirty?: (id: SectionId) => void;
};

type ReconciliationOverride = {
  declaredOverrides: Record<string, number | null>;
  variancePctThreshold: number;
  acknowledged: boolean;
};

const DEFAULT_THRESHOLD_PCT = 1;

// Variance bands:
//   <threshold       green pill   — within tolerance
//   threshold..5×    amber pill   — review
//   >5×              red pill     — likely block-on-apply
function varianceClass(variancePct: number, threshold: number): string {
  const abs = Math.abs(variancePct);
  if (abs < threshold) return 'pill pill-success';
  if (abs <= threshold * 5) return 'pill pill-warn';
  return 'pill pill-error';
}

export function ReconciliationSection({ draft, markSectionDirty }: Props) {
  const suggestions = suggestionsFromDraft(draft.progress);
  const { reconciliation } = suggestions;

  const persisted = useMemo<ReconciliationOverride>(() => {
    const fallback: ReconciliationOverride = {
      declaredOverrides: {},
      variancePctThreshold: DEFAULT_THRESHOLD_PCT,
      acknowledged: false,
    };
    if (!draft.progress || typeof draft.progress !== 'object' || Array.isArray(draft.progress)) {
      return fallback;
    }
    const obj = draft.progress as { brokerOverrides?: Record<string, unknown> };
    const v = obj.brokerOverrides?.reconciliation as Partial<ReconciliationOverride> | undefined;
    if (!v || typeof v !== 'object') return fallback;
    return {
      declaredOverrides:
        v.declaredOverrides && typeof v.declaredOverrides === 'object'
          ? { ...v.declaredOverrides }
          : {},
      variancePctThreshold:
        typeof v.variancePctThreshold === 'number' ? v.variancePctThreshold : DEFAULT_THRESHOLD_PCT,
      acknowledged: Boolean(v.acknowledged),
    };
  }, [draft.progress]);

  const [override, setOverride] = useState<ReconciliationOverride>(persisted);

  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  const mutateRef = useRef(saveOverride.mutate);
  useEffect(() => {
    mutateRef.current = saveOverride.mutate;
  }, [saveOverride.mutate]);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      mutateRef.current({
        draftId: draft.id,
        namespace: 'reconciliation',
        value: override,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [override, draft.id]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    markSectionDirty?.('reconciliation');
  }, [markSectionDirty]);

  const setDeclared = (key: string, value: number | null) => {
    markDirty();
    setOverride((prev) => ({
      ...prev,
      declaredOverrides: { ...prev.declaredOverrides, [key]: value },
    }));
  };
  const setThreshold = (value: number) => {
    markDirty();
    setOverride((prev) => ({ ...prev, variancePctThreshold: value }));
  };
  const setAcknowledged = (value: boolean) => {
    markDirty();
    setOverride((prev) => ({ ...prev, acknowledged: value }));
  };

  // Per-product declared total: broker override > AI/heuristic > null.
  const rows = useMemo(() => {
    return reconciliation.perProduct.map((row) => {
      const key = `${row.productTypeCode}::${row.insurerCode}`;
      const overrideDeclared =
        key in override.declaredOverrides ? override.declaredOverrides[key] : undefined;
      const declared = overrideDeclared !== undefined ? overrideDeclared : row.declared;
      const computed = row.computed;
      const variancePct =
        computed != null && declared != null && computed > 0
          ? ((declared - computed) / computed) * 100
          : null;
      return {
        key,
        productTypeCode: row.productTypeCode,
        insurerCode: row.insurerCode,
        computed,
        declared,
        variancePct,
        wasOverridden: overrideDeclared !== undefined,
      };
    });
  }, [reconciliation.perProduct, override.declaredOverrides]);

  // Recompute grand totals from the visible rows so broker edits flow
  // into the summary line without a server round-trip.
  const grandComputed = rows.reduce((acc, r) => acc + (r.computed ?? 0), 0);
  const declaredSum = rows.reduce((acc, r) => acc + (r.declared ?? 0), 0);
  const grandDeclared = rows.some((r) => r.declared != null) ? declaredSum : null;
  const grandVariancePct =
    grandComputed > 0 && grandDeclared != null
      ? ((grandDeclared - grandComputed) / grandComputed) * 100
      : null;

  const hasBreach = rows.some(
    (r) => r.variancePct != null && Math.abs(r.variancePct) >= override.variancePctThreshold,
  );

  return (
    <>
      <h2>Reconciliation</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Per-product premium totals</h3>
          {rows.length === 0 ? (
            <p className="field-help mb-0">
              Nothing to reconcile yet — the extractor produced no rate rows.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Insurer</th>
                    <th style={{ textAlign: 'right' }}>Computed</th>
                    <th style={{ textAlign: 'right' }}>Slip declared</th>
                    <th style={{ textAlign: 'right' }}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <code>{row.productTypeCode}</code>
                      </td>
                      <td>{row.insurerCode}</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.computed != null
                          ? row.computed.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          step={0.01}
                          value={row.declared ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === '') {
                              setDeclared(row.key, null);
                              return;
                            }
                            const n = Number.parseFloat(raw);
                            setDeclared(row.key, Number.isFinite(n) ? n : null);
                          }}
                          style={{ width: '8rem', textAlign: 'right' }}
                          placeholder="—"
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.variancePct != null ? (
                          <span
                            className={varianceClass(
                              row.variancePct,
                              override.variancePctThreshold,
                            )}
                          >
                            {row.variancePct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                    <td colSpan={2}>Grand total</td>
                    <td style={{ textAlign: 'right' }}>
                      {grandComputed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {grandDeclared != null ? (
                        grandDeclared.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {grandVariancePct != null ? (
                        <span
                          className={varianceClass(grandVariancePct, override.variancePctThreshold)}
                        >
                          {grandVariancePct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div
            className="form-grid mt-4"
            style={{ gridTemplateColumns: 'auto 1fr', gap: '0.75rem 1rem', alignItems: 'center' }}
          >
            <label className="field-label" htmlFor="variance-threshold" style={{ marginBottom: 0 }}>
              Variance threshold (%)
            </label>
            <div>
              <input
                id="variance-threshold"
                className="input"
                type="number"
                min={0}
                step={0.5}
                value={override.variancePctThreshold}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  setThreshold(Number.isFinite(n) ? n : DEFAULT_THRESHOLD_PCT);
                }}
                style={{ width: '6rem' }}
              />
              <span className="field-help" style={{ marginLeft: '0.5rem' }}>
                Apply will block when any per-product variance breaches this threshold.
              </span>
            </div>
          </div>

          {hasBreach ? (
            <div className="mt-3">
              <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={override.acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  At least one product&rsquo;s variance breaches the threshold. Tick to acknowledge
                  — Apply will proceed anyway.
                </span>
              </label>
            </div>
          ) : null}

          {grandDeclared == null && rows.every((r) => r.declared == null) ? (
            <p className="field-help mt-3">
              <strong>Note:</strong> Slip-declared totals are not yet auto-extracted by the parser.
              Enter the figures from your billing-numbers sheet manually here, or wait for the AI
              extractor&rsquo;s reconciliation pass to fill them.
            </p>
          ) : null}
        </Card>
      </section>
    </>
  );
}
