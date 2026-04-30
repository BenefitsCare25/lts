// =============================================================
// SourceSummarySection — read-only summary of the workbook plus the
// "Run AI extraction" trigger.
//
// The button is the broker's explicit consent to spend tenant tokens
// (the platform is BYOK — every extraction costs the tenant). The
// shell polls the draft every 2s while status === 'EXTRACTING' so
// the button + status pill flip live.
//
// Failure messaging is co-located here. If the extraction fails the
// section explains *what* happened and offers a retry — there is no
// other surface a broker would naturally look for AI status.
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/server/trpc/router';
import type { inferRouterOutputs } from '@trpc/server';
import Link from 'next/link';
import { useState } from 'react';
import { aiBundleFromDraft } from './_types';

type DraftQuery = inferRouterOutputs<AppRouter>['extractionDrafts']['byUploadId'];

interface ParseResultLite {
  detectedTemplate?: string | null;
  products?: { productTypeCode: string; templateInsurerCode: string }[];
  policyEntities?: { policyNumber: string; legalName: string; isMaster: boolean }[];
  issues?: { severity: string; code: string; message: string; resolved?: boolean }[];
  raw?: { sheets?: string[] };
}

export function SourceSummarySection({ draft }: { draft: DraftQuery }) {
  const upload = draft.upload;
  const parseResult = (upload.parseResult as ParseResultLite | null) ?? null;
  const sheets = parseResult?.raw?.sheets ?? [];
  const products = parseResult?.products ?? [];
  const policyEntities = parseResult?.policyEntities ?? [];
  const openIssues = (parseResult?.issues ?? []).filter((i) => !i.resolved);
  const aiBundle = aiBundleFromDraft(draft.progress);
  const inlineFallback = !upload.storageKey.startsWith('sharepoint:');

  const utils = trpc.useUtils();
  const aiProvider = trpc.tenantAiProvider.getMasked.useQuery();
  const [error, setError] = useState<string | null>(null);
  const runExtraction = trpc.extractionDrafts.runAiExtraction.useMutation({
    onSuccess: () => {
      setError(null);
      // Force an immediate refetch of the draft so the wizard's
      // status pill flips to EXTRACTING without waiting for the
      // shell's 2s poll cycle.
      utils.extractionDrafts.byUploadId.invalidate({ uploadId: upload.id });
    },
    onError: (err) => setError(err.message),
  });

  const isRunning = draft.status === 'EXTRACTING';
  const isApplied = draft.status === 'APPLIED';
  const aiConfigured = aiProvider.data?.configured === true;
  const buttonLabel =
    draft.status === 'READY' && aiBundle.ai
      ? 'Re-run AI extraction'
      : draft.status === 'FAILED'
        ? 'Retry AI extraction'
        : 'Run AI extraction';

  return (
    <>
      <h2>Source file</h2>

      <section className="section">
        <Card className="card-padded">
          <dl className="kv-list">
            <dt>File</dt>
            <dd>{upload.filename}</dd>
            <dt>Uploaded</dt>
            <dd>{new Date(upload.createdAt).toLocaleString()}</dd>
            <dt>Sheets detected</dt>
            <dd>{sheets.length === 0 ? '—' : sheets.join(', ')}</dd>
            <dt>Templates matched</dt>
            <dd>{upload.insurerTemplate ?? '—'}</dd>
            <dt>Parse status</dt>
            <dd>
              <span className="pill pill-muted">{upload.parseStatus}</span>
            </dd>
            <dt>Extraction status</dt>
            <dd>
              <span
                className={
                  draft.status === 'READY'
                    ? 'pill pill-success'
                    : draft.status === 'FAILED'
                      ? 'pill pill-error'
                      : 'pill pill-muted'
                }
              >
                {draft.status}
                {aiBundle.stage && draft.status === 'EXTRACTING' ? ` · ${aiBundle.stage}` : ''}
              </span>
            </dd>
          </dl>
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">AI extraction</h3>
          {inlineFallback ? (
            <p className="field-help mb-0">
              <strong>SharePoint storage was unavailable when this file was uploaded.</strong> AI
              extraction needs the workbook bytes from SharePoint. Re-upload the slip from the{' '}
              <Link href="/admin/clients/new">new-client page</Link> when storage is back online to
              enable AI extraction.
            </p>
          ) : !aiConfigured ? (
            <p className="field-help mb-0">
              <strong>No AI provider configured for this tenant.</strong>{' '}
              <Link href="/admin/settings/ai-provider">Set up your Azure AI Foundry credentials</Link>{' '}
              to enable AI extraction.
            </p>
          ) : (
            <>
              <p className="field-help mb-3">
                {aiBundle.ai
                  ? `Last run: ${aiBundle.ai.model} · ${aiBundle.ai.sheetsCount} sheet${
                      aiBundle.ai.sheetsCount === 1 ? '' : 's'
                    } in ${(aiBundle.ai.latencyMs / 1000).toFixed(1)}s · ${
                      aiBundle.ai.inputTokens.toLocaleString()
                    } input + ${aiBundle.ai.outputTokens.toLocaleString()} output tokens.`
                  : 'AI extraction reads the workbook with your tenant’s configured Claude/Foundry deployment and pre-fills the wizard’s sections (client details, policy entities, benefit year, products, plans, premium rates, eligibility). Heuristic-extracted cells with full confidence are preserved; the AI fills the rest.'}
              </p>
              {aiBundle.ai?.workbookTruncated ? (
                <p className="field-help mb-3">
                  <strong>Note:</strong> the workbook exceeded the AI input cap and was truncated.
                  Trailing sheets were skipped — see warnings on the wizard banner.
                </p>
              ) : null}
              {error ? <p className="field-error mb-3">{error}</p> : null}
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isRunning || isApplied || runExtraction.isPending}
                  onClick={() => runExtraction.mutate({ uploadId: upload.id })}
                >
                  {isRunning
                    ? 'Extracting…'
                    : runExtraction.isPending
                      ? 'Queueing…'
                      : buttonLabel}
                </button>
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="section">
        <h3 className="mb-3">Parsed products ({products.length})</h3>
        {products.length === 0 ? (
          <Card className="card-padded">
            <p className="mb-0">
              No products parsed by the heuristic template matcher. Run AI extraction above — the AI
              path doesn&rsquo;t require a registered insurer template.
            </p>
          </Card>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product type</th>
                  <th>Insurer template</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={`${p.productTypeCode}-${p.templateInsurerCode}-${i}`}>
                    <td>
                      <code>{p.productTypeCode}</code>
                    </td>
                    <td>{p.templateInsurerCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h3 className="mb-3">Policy entities ({policyEntities.length})</h3>
        {policyEntities.length === 0 ? (
          <Card className="card-padded">
            <p className="mb-0">
              No policy entities detected by the heuristic. Run AI extraction above to populate this
              section, or add entities manually in the Policy entities section.
            </p>
          </Card>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Master</th>
                  <th>Legal name</th>
                  <th>Policy number</th>
                </tr>
              </thead>
              <tbody>
                {policyEntities.map((e) => (
                  <tr key={e.policyNumber}>
                    <td>{e.isMaster ? '●' : '—'}</td>
                    <td>{e.legalName}</td>
                    <td>
                      <code>{e.policyNumber}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openIssues.length > 0 ? (
        <section className="section">
          <h3 className="mb-3">Open issues ({openIssues.length})</h3>
          <ul className="issue-list">
            {openIssues.map((i, idx) => (
              <li
                key={`${i.code}-${idx}`}
                className={i.severity === 'error' ? 'issue is-error' : 'issue is-warning'}
              >
                <strong>{i.severity.toUpperCase()}</strong> · {i.code} — {i.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
