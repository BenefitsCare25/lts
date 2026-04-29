// =============================================================
// ImportReviewScreen — parse review with issue resolution (S32).
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

type ParseIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  resolved?: boolean;
};

type ParsedProduct = {
  productTypeCode: string;
  templateInsurerCode: string;
  fields: Record<string, unknown>;
  plans: { code: string; row: Record<string, unknown> }[];
  rates: Record<string, unknown>[];
};

type ParseResult = {
  status: string;
  detectedTemplate: string | null;
  products: ParsedProduct[];
  issues: ParseIssue[];
  raw?: { sheets: string[] };
};

type ApplySummary = {
  policyEntitiesUpserted: number;
  productsUpserted: number;
  plansCreated: number;
  stacksOnResolved: number;
  premiumRatesCreated: number;
  skipped: { reason: string; detail: string }[];
};

export function ImportReviewScreen({
  clientId,
  uploadId,
}: {
  clientId: string;
  uploadId: string;
}) {
  const utils = trpc.useUtils();
  const upload = trpc.placementSlips.byId.useQuery({ id: uploadId });
  const resolve = trpc.placementSlips.resolveIssue.useMutation({
    onSuccess: () => utils.placementSlips.byId.invalidate({ id: uploadId }),
  });

  const policies = trpc.policies.listByClient.useQuery({ clientId });

  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [selectedBenefitYearId, setSelectedBenefitYearId] = useState('');
  const [applyResult, setApplyResult] = useState<ApplySummary | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const benefitYears = trpc.benefitYears.listByPolicy.useQuery(
    { policyId: selectedPolicyId },
    { enabled: Boolean(selectedPolicyId) },
  );

  const applyMutation = trpc.placementSlips.applyToCatalogue.useMutation({
    onSuccess: (data) => {
      setApplyResult(data.summary);
      setApplyError(null);
      utils.placementSlips.byId.invalidate({ id: uploadId });
    },
    onError: (err) => setApplyError(err.message),
  });

  if (upload.isLoading) return <p>Loading…</p>;
  if (upload.error) return <p className="field-error">Failed to load: {upload.error.message}</p>;
  if (!upload.data) return null;

  const result = (upload.data.parseResult as ParseResult | null) ?? {
    status: upload.data.parseStatus,
    detectedTemplate: upload.data.insurerTemplate,
    products: [],
    issues: [],
  };
  const issues = (upload.data.issues as ParseIssue[] | null) ?? result.issues ?? [];
  const blockers = issues.filter((i) => i.severity === 'error' && !i.resolved);
  const canApply =
    blockers.length === 0 && upload.data.parseStatus === 'PARSED' && Boolean(selectedBenefitYearId);

  const draftBenefitYears = (benefitYears.data ?? []).filter((by) => by.state === 'DRAFT');

  const handleApply = () => {
    if (!selectedBenefitYearId) return;
    setApplyResult(null);
    setApplyError(null);
    applyMutation.mutate({ id: uploadId, benefitYearId: selectedBenefitYearId });
  };

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href={`/admin/clients/${clientId}/imports`}>← Imports</Link>
        </p>
        <h1>{upload.data.filename}</h1>
        <p className="field-help">
          Status <strong>{upload.data.parseStatus}</strong>
          {upload.data.insurerTemplate ? ` · template ${upload.data.insurerTemplate}` : ''}
        </p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '0.5rem' }}>Issues</h3>
          {issues.length === 0 ? (
            <p style={{ color: 'var(--color-good, #16a34a)' }}>✓ No issues — parse succeeded.</p>
          ) : (
            <ul>
              {issues.map((issue, idx) => (
                <li
                  key={`${issue.code}-${idx}`}
                  style={{
                    color: issue.resolved
                      ? 'var(--color-good, #16a34a)'
                      : issue.severity === 'error'
                        ? 'var(--color-error, #b91c1c)'
                        : 'var(--color-warn, #92400e)',
                    marginBottom: '0.4rem',
                    listStyle: 'none',
                  }}
                >
                  <strong>{issue.severity.toUpperCase()}</strong> · {issue.code} — {issue.message}
                  {!issue.resolved ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() => resolve.mutate({ id: uploadId, issueIndex: idx })}
                      disabled={resolve.isPending}
                    >
                      Mark resolved
                    </button>
                  ) : (
                    <span style={{ marginLeft: '0.5rem' }}>(resolved)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>
          Parsed products ({result.products?.length ?? 0})
        </h3>
        {result.products && result.products.length > 0 ? (
          <div className="form-grid">
            {result.products.map((p) => (
              <div key={p.productTypeCode} className="card card-padded">
                <h4 style={{ marginBottom: '0.5rem' }}>
                  <code>{p.productTypeCode}</code>
                </h4>
                <p className="field-help">From template {p.templateInsurerCode}</p>
                <details style={{ marginTop: '0.5rem' }}>
                  <summary>Fields ({Object.keys(p.fields).length})</summary>
                  <pre style={{ fontSize: 'var(--font-md, 12px)' }}>
                    {JSON.stringify(p.fields, null, 2)}
                  </pre>
                </details>
                <details>
                  <summary>Plans ({p.plans.length})</summary>
                  <pre style={{ fontSize: 'var(--font-md, 12px)' }}>
                    {JSON.stringify(p.plans, null, 2)}
                  </pre>
                </details>
                <details>
                  <summary>Rate rows ({p.rates.length})</summary>
                  <pre style={{ fontSize: 'var(--font-md, 12px)' }}>
                    {JSON.stringify(p.rates, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <div className="card card-padded">
            <p style={{ marginBottom: 0 }}>
              No products parsed from this slip. Resolve template-detection issues first.
            </p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '0.5rem' }}>Apply</h3>
          <p className="field-help" style={{ marginBottom: '0.75rem' }}>
            Once every issue is resolved, applying creates real Product / Plan / PremiumRate rows
            under a chosen benefit year. Re-applying the same slip is idempotent.
          </p>

          {upload.data.parseStatus !== 'APPLIED' ? (
            <div className="form-grid" style={{ gap: '0.75rem' }}>
              <div className="field">
                <label className="field-label" htmlFor="apply-policy">
                  Policy
                </label>
                <select
                  id="apply-policy"
                  className="input"
                  value={selectedPolicyId}
                  onChange={(e) => {
                    setSelectedPolicyId(e.target.value);
                    setSelectedBenefitYearId('');
                  }}
                  disabled={policies.isLoading}
                >
                  <option value="">— select policy —</option>
                  {(policies.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPolicyId ? (
                <div className="field">
                  <label className="field-label" htmlFor="apply-benefit-year">
                    Benefit year (DRAFT only)
                  </label>
                  <select
                    id="apply-benefit-year"
                    className="input"
                    value={selectedBenefitYearId}
                    onChange={(e) => setSelectedBenefitYearId(e.target.value)}
                    disabled={benefitYears.isLoading}
                  >
                    <option value="">— select benefit year —</option>
                    {draftBenefitYears.map((by) => (
                      <option key={by.id} value={by.id}>
                        {new Date(by.startDate).toLocaleDateString()} →{' '}
                        {new Date(by.endDate).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                  {draftBenefitYears.length === 0 && !benefitYears.isLoading ? (
                    <span className="field-help">
                      No DRAFT benefit years on this policy.{' '}
                      <Link
                        href={`/admin/clients/${clientId}/policies/${selectedPolicyId}/benefit-years/new`}
                      >
                        Create one
                      </Link>
                      .
                    </span>
                  ) : null}
                </div>
              ) : null}

              {applyError ? <p className="field-error">{applyError}</p> : null}

              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canApply || applyMutation.isPending}
                  onClick={handleApply}
                >
                  {applyMutation.isPending ? 'Applying…' : 'Apply to catalogue'}
                </button>
              </div>

              {!canApply && !applyMutation.isPending ? (
                <p className="field-help">
                  {blockers.length > 0
                    ? `Resolve ${blockers.length} blocker issue${blockers.length === 1 ? '' : 's'} first.`
                    : !selectedBenefitYearId
                      ? 'Select a policy and DRAFT benefit year above.'
                      : `Status must be PARSED — currently ${upload.data.parseStatus}.`}
                </p>
              ) : null}
            </div>
          ) : (
            <p style={{ color: 'var(--color-good, #16a34a)' }}>✓ Already applied to catalogue.</p>
          )}

          {applyResult ? (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: 'var(--bg-subtle)',
                borderRadius: '8px',
              }}
            >
              <h4 style={{ marginBottom: '0.5rem' }}>Apply summary</h4>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, lineHeight: '1.7' }}>
                <li>Policy entities upserted: {applyResult.policyEntitiesUpserted}</li>
                <li>Products upserted: {applyResult.productsUpserted}</li>
                <li>Plans created: {applyResult.plansCreated}</li>
                <li>Premium rates created: {applyResult.premiumRatesCreated}</li>
              </ul>
              {applyResult.skipped.length > 0 ? (
                <>
                  <p
                    style={{
                      marginTop: '0.5rem',
                      marginBottom: '0.25rem',
                      color: 'var(--color-warn)',
                    }}
                  >
                    Skipped ({applyResult.skipped.length}):
                  </p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {applyResult.skipped.map((s, i) => (
                      <li
                        key={`${s.reason}:${s.detail}:${i}`}
                        style={{ fontSize: 'var(--font-md)', color: 'var(--color-warn)' }}
                      >
                        {s.reason}: {s.detail}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
