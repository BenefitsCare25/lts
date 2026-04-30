// =============================================================
// ClaimsScreen — TPA claims feed ingestion + match results.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') {
        reject(new Error('Unexpected file read result.'));
        return;
      }
      const idx = r.indexOf(',');
      resolve(idx === -1 ? r : r.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'));
    reader.readAsDataURL(file);
  });
}

export function ClaimsScreen({ clientId }: { clientId: string }) {
  const insurers = trpc.insurers.list.useQuery();
  const protocols = trpc.claimsFeed.protocolsSupported.useQuery();
  const ingest = trpc.claimsFeed.ingest.useMutation({
    onSuccess: (res) => {
      setResult(res);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const [insurerId, setInsurerId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof ingest.mutateAsync>> | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file || !insurerId) return;
    try {
      const contentBase64 = await readFileAsBase64(file);
      ingest.mutate({ insurerId, clientId, contentBase64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Read failed.');
    }
  };

  const supportedInsurers =
    insurers.data?.filter(
      (ins) =>
        ins.active && ins.claimFeedProtocol && protocols.data?.includes(ins.claimFeedProtocol),
    ) ?? [];

  return (
    <ScreenShell title="Claims">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-2">Upload feed</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="claim-insurer">
                Insurer
              </label>
              <select
                id="claim-insurer"
                className="input"
                required
                value={insurerId}
                onChange={(e) => setInsurerId(e.target.value)}
              >
                <option value="">— Select insurer —</option>
                {supportedInsurers.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.code}) · {i.claimFeedProtocol}
                  </option>
                ))}
              </select>
              {supportedInsurers.length === 0 ? (
                <span className="field-help">
                  No insurers have a supported <code>claimFeedProtocol</code> set. Configure one in
                  the insurer registry. Supported protocols: {protocols.data?.join(', ') ?? '—'}.
                </span>
              ) : null}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="claim-file">
                CSV file
              </label>
              <input
                id="claim-file"
                className="input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!file || !insurerId || ingest.isPending}
              >
                {ingest.isPending ? 'Ingesting…' : 'Ingest feed'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {result ? (
        <section className="section">
          <div className="card card-padded">
            <h3 className="mb-2">Result</h3>
            <p>
              Protocol <code>{result.protocol}</code> · {result.totalRows} rows ·{' '}
              <strong className="text-good">{result.matched} matched</strong> ·{' '}
              <strong className="text-error">{result.unmatched} unmatched</strong>
            </p>
            {result.unmatchedClaims.length > 0 ? (
              <details className="mt-3">
                <summary>Unmatched claims (first 100)</summary>
                <ul>
                  {result.unmatchedClaims.map((c, idx) => (
                    <li key={`${c.memberId}-${idx}`}>
                      <code>{c.memberId}</code> · {c.productCode} · {c.claimDate} — {c.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}
    </ScreenShell>
  );
}
