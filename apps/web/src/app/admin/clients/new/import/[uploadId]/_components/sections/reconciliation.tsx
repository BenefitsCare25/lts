// =============================================================
// ReconciliationSection — per-product premium totals computed
// from the extracted rates vs the slip's declared totals.
//
// Today: declared totals are null (the heuristic parser doesn't
// inspect the billing-numbers sheet yet). The section still
// surfaces computed totals so the broker has a sanity-check
// number; once the parser learns to read the billing block, the
// variance column lights up automatically.
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { suggestionsFromDraft } from './_types';

type Props = {
  draft: { progress: unknown };
};

// Variance bands:
//   <1%   green pill   — within tolerance
//   1-5%  amber pill   — review
//   >5%   red pill     — likely block-on-apply once declared totals wire in
function varianceClass(variancePct: number): string {
  const abs = Math.abs(variancePct);
  if (abs < 1) return 'pill pill-success';
  if (abs <= 5) return 'pill pill-warn';
  return 'pill pill-error';
}

export function ReconciliationSection({ draft }: Props) {
  const suggestions = suggestionsFromDraft(draft.progress);
  const { reconciliation } = suggestions;

  return (
    <>
      <h2>Reconciliation</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Per-product premium totals</h3>
          {reconciliation.perProduct.length === 0 ? (
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
                  {reconciliation.perProduct.map((row, i) => (
                    <tr key={`${row.productTypeCode}-${row.insurerCode}-${i}`}>
                      <td>
                        <code>{row.productTypeCode}</code>
                      </td>
                      <td>{row.insurerCode}</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.computed != null
                          ? row.computed.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.declared != null ? (
                          row.declared.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        ) : (
                          <span className="text-muted">— pending</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.variancePct != null ? (
                          <span className={varianceClass(row.variancePct)}>
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
                      {reconciliation.grandComputed.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {reconciliation.grandDeclared != null ? (
                        reconciliation.grandDeclared.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      ) : (
                        <span className="text-muted">— pending</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {reconciliation.grandVariancePct != null ? (
                        <span className={varianceClass(reconciliation.grandVariancePct)}>
                          {reconciliation.grandVariancePct.toFixed(2)}%
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

          {reconciliation.grandDeclared == null ? (
            <p className="field-help mt-3">
              <strong>Note:</strong> Slip-declared totals are not parsed yet. Once the parser learns
              to read the billing-numbers sheet, the &ldquo;Slip declared&rdquo; and
              &ldquo;Variance&rdquo; columns will populate automatically — Apply will block when
              variance exceeds 1%.
            </p>
          ) : null}
        </Card>
      </section>
    </>
  );
}
