// =============================================================
// SourceSummarySection — read-only summary of what the parser /
// extractor pulled from the workbook. No editable fields here;
// this anchor screen exists so the broker can confirm the file
// landed correctly before diving into per-section forms.
// =============================================================

import { Card } from '@/components/ui';
import type { AppRouter } from '@/server/trpc/router';
import type { inferRouterOutputs } from '@trpc/server';

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
              <span className="pill pill-muted">{draft.status}</span>
            </dd>
          </dl>
        </Card>
      </section>

      <section className="section">
        <h3 className="mb-3">Parsed products ({products.length})</h3>
        {products.length === 0 ? (
          <Card className="card-padded">
            <p className="mb-0">
              No products parsed from this slip. Resolve template-detection issues, or upload a slip
              whose sheet names match a registered insurer template.
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
              No policy entities detected. You can still add them manually in the Policy entities
              section.
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
