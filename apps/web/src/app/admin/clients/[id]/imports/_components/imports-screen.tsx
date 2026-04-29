// =============================================================
// ImportsScreen — placement-slip upload + history (S29).
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

const formatDate = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString();
};

const statusPill = (status: string) => {
  if (status === 'PARSED') return 'pill pill-success';
  if (status === 'APPLIED') return 'pill pill-success';
  if (status === 'FAILED') return 'pill pill-muted';
  return 'pill pill-muted';
};

// Reads a File as a base64 string. Strips the data: prefix.
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file read result.'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'));
    reader.readAsDataURL(file);
  });
}

export function ImportsScreen({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.placementSlips.listByClient.useQuery({ clientId });
  const upload = trpc.placementSlips.upload.useMutation({
    onSuccess: async () => {
      setSelected(null);
      setUploadError(null);
      await utils.placementSlips.listByClient.invalidate({ clientId });
    },
    onError: (err) => setUploadError(err.message),
  });
  const reparse = trpc.placementSlips.reparse.useMutation({
    onSuccess: () => utils.placementSlips.listByClient.invalidate({ clientId }),
  });
  const remove = trpc.placementSlips.delete.useMutation({
    onSuccess: () => utils.placementSlips.listByClient.invalidate({ clientId }),
  });

  const [selected, setSelected] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setUploadError(null);
    try {
      const contentBase64 = await readFileAsBase64(selected);
      upload.mutate({ clientId, filename: selected.name, contentBase64 });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read file.');
    }
  };

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href={`/admin/clients/${clientId}/edit`}>← Client</Link>
        </p>
        <h1>Imports</h1>
        <p style={{ maxWidth: '60ch' }}>
          Upload an insurer placement slip and the parser will detect the template, extract product
          instances, plans, and rates. Review the parse result before applying it to the catalogue.
        </p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '0.75rem' }}>Upload placement slip</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="slip-file">
                Excel file (.xlsx, .xlsm)
              </label>
              <input
                id="slip-file"
                className="input"
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
              />
              <span className="field-help">
                Maximum 25 MB. Parsed synchronously. Stored on SharePoint (
                <code>/lts-placement-slips/&lt;tenant&gt;/&lt;client&gt;/</code>) when the Azure
                ROPC env vars are configured; otherwise the bytes aren't retained and re-parse will
                require re-upload.
              </span>
            </div>
            {uploadError ? <p className="field-error">{uploadError}</p> : null}
            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!selected || upload.isPending}
              >
                {upload.isPending ? 'Parsing…' : 'Upload + parse'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Past uploads</h3>
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Insurer template</th>
                  <th>Status</th>
                  <th>Storage</th>
                  <th>Uploaded</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((u) => {
                  const onSharePoint = u.storageKey.startsWith('sharepoint:');
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.storageWebUrl ? (
                          <a
                            href={u.storageWebUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'underline', color: 'inherit' }}
                          >
                            {u.filename}
                          </a>
                        ) : (
                          u.filename
                        )}
                      </td>
                      <td>{u.insurerTemplate ?? '—'}</td>
                      <td>
                        <span className={statusPill(u.parseStatus)}>{u.parseStatus}</span>
                      </td>
                      <td>
                        <span className={onSharePoint ? 'pill pill-success' : 'pill pill-muted'}>
                          {onSharePoint ? 'SharePoint' : 'Inline'}
                        </span>
                      </td>
                      <td style={{ fontSize: 'var(--font-md, 12px)' }}>
                        {formatDate(u.createdAt)}
                      </td>
                      <td>
                        <div className="row-end">
                          <Link
                            href={`/admin/clients/${clientId}/imports/${u.id}`}
                            className="btn btn-ghost btn-sm"
                          >
                            Review
                          </Link>
                          {onSharePoint ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => reparse.mutate({ id: u.id })}
                              disabled={reparse.isPending}
                            >
                              {reparse.isPending ? 'Re-parsing…' : 'Re-parse'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete ${u.filename}? This removes the SharePoint copy too.`,
                                )
                              ) {
                                remove.mutate({ id: u.id });
                              }
                            }}
                            disabled={remove.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-padded" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 0 }}>No uploads yet.</p>
          </div>
        )}
      </section>
    </>
  );
}
