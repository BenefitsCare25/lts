'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import type { SectionId } from './_registry';
import { aiBundleFromDraft, extractedProductsFromDraft, readBrokerOverride } from './_types';

type Props = {
  draft: {
    id: string;
    extractedProducts: unknown;
    progress: unknown;
    upload: { parseResult: unknown };
  };
  markSectionDirty?: (id: SectionId) => void;
};

type InsurerOverride = {
  // Map from detected insurer code (e.g. "GE_LIFE") to the registry
  // Insurer.id the broker has confirmed it belongs to. null means
  // "ignore — broker has reviewed but registry binding is pending".
  codeToRegistryId: Record<string, string | null>;
};

type PoolOverride = {
  poolId: string | null;
  name: string | null;
};

export function InsurersPoolSection({ draft, markSectionDirty }: Props) {
  const insurersQuery = trpc.insurers.list.useQuery();
  const poolsQuery = trpc.pools.list.useQuery();

  const extracted = extractedProductsFromDraft(draft.extractedProducts);
  const aiBundle = useMemo(() => aiBundleFromDraft(draft.progress), [draft.progress]);

  const [insurerOverride, setInsurerOverride] = useState<InsurerOverride>(() => {
    const persisted = readBrokerOverride<InsurerOverride>(draft.progress, 'insurers', {
      codeToRegistryId: {},
    });
    return { codeToRegistryId: { ...(persisted.codeToRegistryId ?? {}) } };
  });
  const [poolOverride, setPoolOverride] = useState<PoolOverride>(() => {
    const persisted = readBrokerOverride<PoolOverride>(draft.progress, 'pool', {
      poolId: null,
      name: null,
    });
    return { poolId: persisted.poolId ?? null, name: persisted.name ?? null };
  });

  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  const markInsurerDirty = useDebouncedAutosave(insurerOverride, (value) =>
    saveOverride.mutate({ draftId: draft.id, namespace: 'insurers', value }),
  );
  const markPoolDirty = useDebouncedAutosave(poolOverride, (value) =>
    saveOverride.mutate({ draftId: draft.id, namespace: 'pool', value }),
  );

  const markDirty = useCallback(() => {
    markInsurerDirty();
    markPoolDirty();
    markSectionDirty?.('insurers');
  }, [markInsurerDirty, markPoolDirty, markSectionDirty]);

  // Unique insurer codes from extracted products + AI's discovery pass.
  const insurerSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of extracted) {
      counts.set(p.insurerCode, (counts.get(p.insurerCode) ?? 0) + 1);
    }
    for (const i of aiBundle.proposedInsurers) {
      if (!counts.has(i.code)) counts.set(i.code, i.productCount);
    }
    const registry = insurersQuery.data ?? [];
    return Array.from(counts.entries()).map(([code, productCount]) => {
      // Override has priority over auto-match — the broker's pick wins.
      const overrideId = insurerOverride.codeToRegistryId[code] ?? null;
      const overriddenMatch = overrideId ? registry.find((i) => i.id === overrideId) : null;
      const autoMatch = registry.find((i) => i.code === code) ?? null;
      const match = overriddenMatch ?? autoMatch;
      return {
        code,
        productCount,
        registryName: match?.name ?? null,
        registryId: match?.id ?? null,
        active: match?.active ?? false,
        // Has the broker explicitly bound this code? Even when it
        // collides with autoMatch we still surface "broker confirmed"
        // so the row is a stable target.
        brokerConfirmed: code in insurerOverride.codeToRegistryId,
      };
    });
  }, [extracted, aiBundle.proposedInsurers, insurersQuery.data, insurerOverride]);

  const setInsurerMapping = useCallback(
    (code: string, registryId: string | null) => {
      markDirty();
      setInsurerOverride((prev) => ({
        codeToRegistryId: { ...prev.codeToRegistryId, [code]: registryId },
      }));
    },
    [markDirty],
  );

  const clearInsurerMapping = useCallback(
    (code: string) => {
      markDirty();
      setInsurerOverride((prev) => {
        const next = { ...prev.codeToRegistryId };
        delete next[code];
        return { codeToRegistryId: next };
      });
    },
    [markDirty],
  );

  // Pool name detection — heuristic fields are the floor; AI fills when
  // the heuristic doesn't see a Pool row. Workbook-level info repeated
  // across every product sheet, so the first non-empty hit is fine.
  const detectedPoolName = useMemo(() => {
    const result =
      (draft.upload.parseResult as null | {
        products?: { fields?: Record<string, unknown> }[];
      }) ?? null;
    for (const p of result?.products ?? []) {
      const name = String(p.fields?.pool_name ?? '').trim();
      if (name && name !== 'NA' && name !== 'N.A') return name;
    }
    return aiBundle.proposedPool?.name ?? null;
  }, [draft.upload.parseResult, aiBundle.proposedPool]);

  // Auto-resolve detected pool against the registry. The broker's
  // override wins when set.
  const resolvedPool = useMemo(() => {
    if (poolOverride.poolId) {
      return poolsQuery.data?.find((p) => p.id === poolOverride.poolId) ?? null;
    }
    if (aiBundle.proposedPool?.poolId) {
      return poolsQuery.data?.find((p) => p.id === aiBundle.proposedPool?.poolId) ?? null;
    }
    if (detectedPoolName) {
      return (
        poolsQuery.data?.find((p) => p.name.toLowerCase() === detectedPoolName.toLowerCase()) ??
        null
      );
    }
    return null;
  }, [poolOverride, aiBundle.proposedPool, detectedPoolName, poolsQuery.data]);

  const setPoolPick = (poolId: string | null) => {
    markDirty();
    const match = poolId ? poolsQuery.data?.find((p) => p.id === poolId) : null;
    setPoolOverride({ poolId, name: match?.name ?? null });
  };

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
            <>
              <p className="field-help mb-3">
                Each detected code below is mapped against your Insurer registry. Re-bind a code
                here when the AI mis-attributes a product (e.g. a sheet labelled &ldquo;Chubb&rdquo;
                whose insurer cell says &ldquo;Zurich&rdquo;).
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Detected code</th>
                      <th>Bind to registry insurer</th>
                      <th>Products</th>
                      <th>Status</th>
                      <th aria-label="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {insurerSummary.map((row) => (
                      <tr key={row.code}>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>
                          <select
                            className="input"
                            value={row.registryId ?? ''}
                            onChange={(e) => setInsurerMapping(row.code, e.target.value || null)}
                            disabled={insurersQuery.isLoading}
                          >
                            <option value="">— pick an insurer —</option>
                            {(insurersQuery.data ?? []).map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.code}){i.active ? '' : ' · inactive'}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{row.productCount}</td>
                        <td>
                          {row.registryId ? (
                            <span className={row.active ? 'pill pill-success' : 'pill pill-muted'}>
                              {row.active ? 'in registry' : 'inactive'}
                            </span>
                          ) : (
                            <span className="pill pill-muted">unmapped</span>
                          )}
                          {row.brokerConfirmed ? (
                            <ConfidenceBadge confidence={1} variant="dot" />
                          ) : null}
                        </td>
                        <td>
                          <div className="row" style={{ gap: '0.25rem' }}>
                            {row.registryId ? (
                              <Link
                                className="btn btn-ghost btn-sm"
                                href={`/admin/catalogue/insurers/${row.registryId}/edit`}
                              >
                                View
                              </Link>
                            ) : (
                              <Link
                                className="btn btn-primary btn-sm"
                                href="/admin/catalogue/insurers"
                              >
                                Add new →
                              </Link>
                            )}
                            {row.brokerConfirmed ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => clearInsurerMapping(row.code)}
                              >
                                Reset
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Pool</h3>
          <p className="field-help mb-3">
            {detectedPoolName ? (
              <>
                Slip mentions <strong>{detectedPoolName}</strong>{' '}
                <ConfidenceBadge confidence={0.9} variant="dot" />.
              </>
            ) : (
              <>No pool / captive arrangement detected on the slip.</>
            )}
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="field">
              <label className="field-label" htmlFor="pool-pick">
                Bind to registry pool
              </label>
              <select
                id="pool-pick"
                className="input"
                value={poolOverride.poolId ?? resolvedPool?.id ?? ''}
                onChange={(e) => setPoolPick(e.target.value || null)}
                disabled={poolsQuery.isLoading}
              >
                <option value="">— no pool —</option>
                {(poolsQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="field"
              style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.25rem' }}
            >
              <Link className="btn btn-ghost btn-sm" href="/admin/catalogue/pools">
                Manage pools →
              </Link>
            </div>
          </div>
          {resolvedPool ? (
            <p className="field-help mt-3 mb-0">
              Resolved to pool <strong>{resolvedPool.name}</strong> in your registry.{' '}
              <Link href={`/admin/catalogue/pools/${resolvedPool.id}/edit`}>Edit members →</Link>
            </p>
          ) : null}
        </Card>
      </section>

    </>
  );
}
