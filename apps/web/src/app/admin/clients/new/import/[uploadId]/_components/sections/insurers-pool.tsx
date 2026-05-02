'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { PRODUCT_TYPE_CODES } from '@insurance-saas/shared-types';
import type { ProductTypeCode } from '@insurance-saas/shared-types';
import Link from 'next/link';
import { Fragment, useCallback, useMemo, useState } from 'react';
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

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// "GE_LIFE" → "GE Life", "ALLIANZ" → "Allianz"
function inferName(code: string): string {
  return code
    .split('_')
    .map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

// Ensure the detected code is a valid registry code (uppercase, no spaces).
function normalizeCode(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return /^[A-Z]/.test(upper) ? upper : `I${upper}`;
}

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

  // Inline create form state — only one row can be expanded at a time.
  const [expandedCreate, setExpandedCreate] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [createProducts, setCreateProducts] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

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

  const createInsurerMutation = trpc.insurers.create.useMutation({
    onSuccess: (newInsurer) => {
      if (expandedCreate) setInsurerMapping(expandedCreate, newInsurer.id);
      void insurersQuery.refetch();
      setExpandedCreate(null);
      setCreateError(null);
    },
    onError: (err) => {
      setCreateError(err.message);
    },
  });

  function openCreateForm(detectedCode: string) {
    const validProductCodes = new Set<string>(PRODUCT_TYPE_CODES);
    const inferred = [
      ...new Set(
        extracted
          .filter((p) => p.insurerCode === detectedCode)
          .map((p) => p.productTypeCode)
          .filter((ptc) => validProductCodes.has(ptc)),
      ),
    ];
    setCreateName(inferName(detectedCode));
    setCreateCode(normalizeCode(detectedCode));
    setCreateProducts(inferred);
    setCreateError(null);
    setExpandedCreate(detectedCode);
  }

  function handleCreate() {
    createInsurerMutation.mutate({
      name: createName.trim(),
      code: createCode,
      productsSupported: createProducts as ProductTypeCode[],
      claimFeedProtocol: null,
      active: true,
    });
  }

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

  const codeInvalid = createCode.length > 0 && !CODE_PATTERN.test(createCode);
  const canCreate =
    createName.trim().length > 0 &&
    CODE_PATTERN.test(createCode) &&
    createProducts.length > 0 &&
    !createInsurerMutation.isPending;

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
                      <Fragment key={row.code}>
                        <tr>
                          <td>
                            <code>{row.code}</code>
                          </td>
                          <td>
                            <select
                              className="input"
                              value={row.registryId ?? ''}
                              onChange={(e) =>
                                setInsurerMapping(row.code, e.target.value || null)
                              }
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
                              <span
                                className={row.active ? 'pill pill-success' : 'pill pill-muted'}
                              >
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
                              ) : expandedCreate === row.code ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setExpandedCreate(null)}
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => openCreateForm(row.code)}
                                >
                                  Add new →
                                </button>
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

                        {expandedCreate === row.code && (
                          <tr>
                            <td colSpan={5} style={{ padding: '0 0 0.75rem' }}>
                              <div
                                className="bg-muted"
                                style={{ padding: '1rem', borderRadius: '0.5rem' }}
                              >
                                <p className="field-help mb-3">
                                  Create a new insurer in your registry and bind{' '}
                                  <code>{row.code}</code> to it.
                                </p>
                                <div
                                  className="form-grid mb-3"
                                  style={{ gridTemplateColumns: '1fr 1fr' }}
                                >
                                  <div className="field mb-0">
                                    <label className="field-label" htmlFor={`ci-name-${row.code}`}>
                                      Name
                                    </label>
                                    <input
                                      id={`ci-name-${row.code}`}
                                      className="input"
                                      value={createName}
                                      onChange={(e) => setCreateName(e.target.value)}
                                      placeholder="e.g. Allianz Insurance"
                                    />
                                  </div>
                                  <div className="field mb-0">
                                    <label className="field-label" htmlFor={`ci-code-${row.code}`}>
                                      Code
                                    </label>
                                    <input
                                      id={`ci-code-${row.code}`}
                                      className="input"
                                      value={createCode}
                                      onChange={(e) =>
                                        setCreateCode(
                                          e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                                        )
                                      }
                                      placeholder="e.g. ALLIANZ"
                                    />
                                    {codeInvalid && (
                                      <p
                                        className="field-help"
                                        style={{ color: 'var(--color-error, #b91c1c)' }}
                                      >
                                        Must start with a letter; uppercase only.
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="field mb-3">
                                  <span className="field-label">Products supported</span>
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: '0.5rem',
                                      marginTop: '0.5rem',
                                    }}
                                  >
                                    {PRODUCT_TYPE_CODES.map((ptc) => (
                                      <label
                                        key={ptc}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '0.25rem',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={createProducts.includes(ptc)}
                                          onChange={(e) =>
                                            setCreateProducts((prev) =>
                                              e.target.checked
                                                ? [...prev, ptc]
                                                : prev.filter((c) => c !== ptc),
                                            )
                                          }
                                        />
                                        <span className="field-help mb-0">{ptc}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                {createError && (
                                  <p
                                    className="field-help mb-3"
                                    style={{ color: 'var(--color-error, #b91c1c)' }}
                                  >
                                    {createError}
                                  </p>
                                )}
                                <div className="row" style={{ gap: '0.5rem' }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={!canCreate}
                                    onClick={handleCreate}
                                  >
                                    {createInsurerMutation.isPending
                                      ? 'Creating…'
                                      : 'Create & bind'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setExpandedCreate(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
              <Link
                className="btn btn-ghost btn-sm"
                href="/admin/catalogue/pools"
                target="_blank"
                rel="noopener noreferrer"
              >
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
