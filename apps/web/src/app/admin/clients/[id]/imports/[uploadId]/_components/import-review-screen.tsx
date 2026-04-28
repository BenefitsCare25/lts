// =============================================================
// ImportReviewScreen — parse review with issue resolution (S32).
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';

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
  const canApply = blockers.length === 0 && upload.data.parseStatus === 'PARSED';

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
            under a chosen benefit year. (Phase 1G ships the apply hook; the row-creation mapping
            fills in once reference placement slips arrive for QA — see PROGRESS.)
          </p>
          <button type="button" className="btn btn-primary" disabled={!canApply}>
            {upload.data.parseStatus === 'APPLIED' ? 'Already applied' : 'Apply to catalogue'}
          </button>
          {!canApply ? (
            <p className="field-help" style={{ marginTop: '0.5rem' }}>
              {blockers.length > 0
                ? `Resolve ${blockers.length} blocker issue${blockers.length === 1 ? '' : 's'} first.`
                : `Status must be PARSED — currently ${upload.data.parseStatus}.`}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
