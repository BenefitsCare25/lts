'use client';

import { Card } from '@/components/ui';
import { useMemo } from 'react';
import type { WizardExtractedProduct, WizardPremiumRateField } from '../_types';
import { COMMON_COVER_TIERS, type ProductPatcher } from './shared';

export function RatesTab({
  product,
  onChange,
}: {
  product: WizardExtractedProduct;
  onChange: ProductPatcher;
}) {
  const bundledWith = (product.header as Record<string, unknown>).bundledWithProductCode as
    | string
    | undefined;

  const updateRate = (idx: number, patch: Partial<WizardPremiumRateField>) => {
    onChange((p) => ({
      ...p,
      premiumRates: p.premiumRates.map((r, i) =>
        i === idx ? { ...r, ...patch, confidence: 1 } : r,
      ),
    }));
  };
  const addRate = (planRawCode: string) => {
    onChange((p) => ({
      ...p,
      premiumRates: [
        ...p.premiumRates,
        {
          planRawCode,
          coverTier: null,
          ratePerThousand: null,
          fixedAmount: null,
          blockLabel: null,
          ageBand: null,
          confidence: 1,
        },
      ],
    }));
  };
  const removeRate = (idx: number) => {
    onChange((p) => ({ ...p, premiumRates: p.premiumRates.filter((_, i) => i !== idx) }));
  };

  if (bundledWith) {
    return (
      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Premium rates</h3>
          <p className="field-help mb-0">
            <strong>Bundled with {bundledWith}.</strong> The slip indicates this product&rsquo;s
            premium is rolled into the {bundledWith} product&rsquo;s rates. No separate rate rows
            are expected here.
          </p>
        </Card>
      </section>
    );
  }

  // Group displayed rates by plan; preserve original index for edits.
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ rate: WizardPremiumRateField; idx: number }>>();
    product.premiumRates.forEach((r, i) => {
      const key = r.planRawCode;
      const list = map.get(key) ?? [];
      list.push({ rate: r, idx: i });
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [product.premiumRates]);

  const planOptions = product.plans
    .filter((p) => p.rawCode)
    .map((p) => ({ rawCode: p.rawCode, label: `${p.code} · ${p.name.slice(0, 40)}` }));

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Premium rates</h3>
        {product.premiumRates.length === 0 ? (
          <p className="field-help mb-3">
            No rates yet. Add one per plan below — pick a plan, then enter rate / fixed amount.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Tier</th>
                  <th>Block</th>
                  <th>Age</th>
                  <th>Rate / 1,000</th>
                  <th>Fixed amount</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap(([planRawCode, rows]) =>
                  rows.map(({ rate, idx }, j) => (
                    <tr key={`${planRawCode}-${idx}`}>
                      {j === 0 ? (
                        <td rowSpan={rows.length}>
                          <select
                            className="input"
                            value={planRawCode}
                            onChange={(e) => {
                              const next = e.target.value;
                              for (const row of rows) {
                                updateRate(row.idx, { planRawCode: next });
                              }
                            }}
                          >
                            <option value={planRawCode}>{planRawCode || '—'}</option>
                            {planOptions
                              .filter((p) => p.rawCode !== planRawCode)
                              .map((p) => (
                                <option key={p.rawCode} value={p.rawCode}>
                                  {p.label}
                                </option>
                              ))}
                          </select>
                        </td>
                      ) : null}
                      <td>
                        <select
                          className="input"
                          value={rate.coverTier ?? ''}
                          onChange={(e) => updateRate(idx, { coverTier: e.target.value || null })}
                          style={{ width: '5rem' }}
                        >
                          <option value="">—</option>
                          {COMMON_COVER_TIERS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="text"
                          value={rate.blockLabel ?? ''}
                          onChange={(e) => updateRate(idx, { blockLabel: e.target.value || null })}
                          style={{ width: '7rem' }}
                          placeholder="(all)"
                        />
                      </td>
                      <td>
                        <div className="row" style={{ gap: '0.15rem', alignItems: 'center' }}>
                          <input
                            className="input"
                            type="number"
                            value={rate.ageBand?.from ?? ''}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              updateRate(idx, {
                                ageBand: Number.isFinite(n)
                                  ? { from: n, to: rate.ageBand?.to ?? n }
                                  : null,
                              });
                            }}
                            style={{ width: '3.5rem' }}
                            placeholder="from"
                          />
                          <span className="text-muted" style={{ fontSize: 'var(--font-sm)' }}>
                            –
                          </span>
                          <input
                            className="input"
                            type="number"
                            value={rate.ageBand?.to ?? ''}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              updateRate(idx, {
                                ageBand:
                                  rate.ageBand != null
                                    ? {
                                        ...rate.ageBand,
                                        to: Number.isFinite(n) ? n : rate.ageBand.from,
                                      }
                                    : null,
                              });
                            }}
                            style={{ width: '3.5rem' }}
                            placeholder="to"
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          step={0.01}
                          value={rate.ratePerThousand ?? ''}
                          onChange={(e) => {
                            const n = Number.parseFloat(e.target.value);
                            updateRate(idx, {
                              ratePerThousand: Number.isFinite(n) ? n : null,
                            });
                          }}
                          style={{ width: '6rem' }}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          step={0.01}
                          value={rate.fixedAmount ?? ''}
                          onChange={(e) => {
                            const n = Number.parseFloat(e.target.value);
                            updateRate(idx, { fixedAmount: Number.isFinite(n) ? n : null });
                          }}
                          style={{ width: '7rem' }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeRate(idx)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="row mt-3" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          {planOptions.length === 0 ? (
            <p className="field-help mb-0">Add at least one plan first to attach rates.</p>
          ) : (
            planOptions.map((p) => (
              <button
                key={p.rawCode}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addRate(p.rawCode)}
              >
                + Add rate for <code>{p.rawCode}</code>
              </button>
            ))
          )}
        </div>
      </Card>
    </section>
  );
}
