// =============================================================
// InsurersPoolSection — surfaces the insurer codes detected on the
// slip and cross-checks each against the tenant's Insurer registry.
// Pool is read from the first product's heuristic fields.
//
// Adding insurers / pools to the registry is a click-out to the
// existing /admin/catalogue surfaces — no inline create here keeps
// the wizard focused.
// =============================================================

'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo } from 'react';
import { extractedProductsFromDraft } from './_types';

type Props = {
  draft: {
    extractedProducts: unknown;
    upload: { parseResult: unknown };
  };
};

export function InsurersPoolSection({ draft }: Props) {
  const insurersQuery = trpc.insurers.list.useQuery();
  const poolsQuery = trpc.pools.list.useQuery();

  const extracted = extractedProductsFromDraft(draft.extractedProducts);

  // Unique insurer codes across all extracted products, with counts.
  const insurerSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of extracted) {
      counts.set(p.insurerCode, (counts.get(p.insurerCode) ?? 0) + 1);
    }
    const registry = insurersQuery.data ?? [];
    return Array.from(counts.entries()).map(([code, productCount]) => {
      const match = registry.find((i) => i.code === code) ?? null;
      return {
        code,
        productCount,
        registryName: match?.name ?? null,
        registryId: match?.id ?? null,
        active: match?.active ?? false,
      };
    });
  }, [extracted, insurersQuery.data]);

  // Pool detection — read from the first product's heuristic fields.
  // This is workbook-level info, repeated across every GE product;
  // taking it from the first match is fine.
  const poolName = useMemo(() => {
    const result = (draft.upload.parseResult as null | {
      products?: { fields?: Record<string, unknown> }[];
    }) ?? null;
    for (const p of result?.products ?? []) {
      const name = String(p.fields?.pool_name ?? '').trim();
      if (name && name !== 'NA' && name !== 'N.A') return name;
    }
    return null;
  }, [draft.upload.parseResult]);

  const poolMatch = useMemo(() => {
    if (!poolName) return null;
    return poolsQuery.data?.find((p) => p.name.toLowerCase() === poolName.toLowerCase()) ?? null;
  }, [poolName, poolsQuery.data]);

  return (
    <>
      <h2>Insurers &amp; pool</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Insurers detected on this slip</h3>
          {insurerSummary.length === 0 ? (
            <p className="field-help mb-0">
              No insurers detected. The parser couldn&rsquo;t match any sheet to a registered
              template.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Registry name</th>
                    <th>Products</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {insurerSummary.map((row) => (
                    <tr key={row.code}>
                      <td>
                        <code>{row.code}</code>
                      </td>
                      <td>{row.registryName ?? <em>not in registry</em>}</td>
                      <td>{row.productCount}</td>
                      <td>
                        {row.registryId ? (
                          <span
                            className={row.active ? 'pill pill-success' : 'pill pill-muted'}
                          >
                            {row.active ? 'in registry' : 'inactive'}
                          </span>
                        ) : (
                          <span className="pill pill-muted">missing</span>
                        )}
                      </td>
                      <td>
                        {row.registryId ? (
                          <Link
                            className="btn btn-ghost btn-sm"
                            href={`/admin/catalogue/insurers/${row.registryId}/edit`}
                          >
                            View
                          </Link>
                        ) : (
                          <Link className="btn btn-primary btn-sm" href="/admin/catalogue/insurers">
                            Add to registry →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Pool</h3>
          {!poolName ? (
            <p className="field-help mb-0">No pool / captive arrangement detected on the slip.</p>
          ) : (
            <>
              <p className="mb-3">
                <strong>{poolName}</strong> <ConfidenceBadge confidence={0.9} variant="dot" />
              </p>
              {poolMatch ? (
                <p className="field-help mb-0">
                  Resolved to pool <strong>{poolMatch.name}</strong> in your registry.{' '}
                  <Link href={`/admin/catalogue/pools/${poolMatch.id}/edit`}>Edit members →</Link>
                </p>
              ) : (
                <p className="field-help mb-0">
                  Pool not in registry yet —{' '}
                  <Link href="/admin/catalogue/pools">add it via Pools admin</Link>, then return.
                </p>
              )}
            </>
          )}
        </Card>
      </section>
    </>
  );
}
