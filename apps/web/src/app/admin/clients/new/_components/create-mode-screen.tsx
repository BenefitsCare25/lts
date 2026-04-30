// =============================================================
// CreateModeScreen — two-tile entry to client creation.
//
// Tile 1 — Import slip
//   File drop zone. On drop, calls placementSlips.uploadOrphan
//   which parses the workbook, persists bytes to SharePoint,
//   creates a PlacementSlipUpload row with clientId=null, and
//   spawns an ExtractionDraft in READY state. Caller is then
//   routed to /admin/clients/new/import/[uploadId].
//
// Tile 2 — Type details
//   Renders the existing manual client form inline (same fields as
//   /admin/clients legacy create form). On success, routes to
//   /admin/clients/[newClientId].
//
// Why two tiles instead of stacking them: brokers reuse the import
// path 90% of the time after onboarding their first client. Making
// it the equal-weight default removes a click from every renewal.
// =============================================================

'use client';

import { Card, ScreenShell } from '@/components/ui';
import { readFileAsBase64 } from '@/lib/file';
import { trpc } from '@/lib/trpc/client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type Mode = 'pick' | 'import' | 'manual';

export function CreateModeScreen() {
  const [mode, setMode] = useState<Mode>('pick');

  return (
    <ScreenShell title="New client">
      {mode === 'pick' ? <ModePicker onPick={setMode} /> : null}
      {mode === 'import' ? <ImportPanel onCancel={() => setMode('pick')} /> : null}
      {mode === 'manual' ? <ManualPanel onCancel={() => setMode('pick')} /> : null}
    </ScreenShell>
  );
}

function ModePicker({ onPick }: { onPick: (mode: Mode) => void }) {
  // Surface in-progress orphan drafts so brokers can resume mid-wizard
  // sessions without losing context.
  const orphans = trpc.extractionDrafts.listOrphans.useQuery();
  const router = useRouter();

  return (
    <>
      <section className="section">
        <div className="form-grid form-grid-2">
          <button
            type="button"
            className="card card-padded card-clickable"
            onClick={() => onPick('import')}
          >
            <h3>⬆ Import slip</h3>
            <p className="field-help">
              Drop a placement slip (.xls / .xlsx). AI extracts every product, plan, rate, and
              eligibility rule into editable forms. Best for renewals.
            </p>
            <p className="field-help">~15 min for an 8-product placement.</p>
          </button>

          <button
            type="button"
            className="card card-padded card-clickable"
            onClick={() => onPick('manual')}
          >
            <h3>✎ Type details</h3>
            <p className="field-help">
              Enter client details manually. Use this for prospects without a signed slip yet, or
              when the slip is in a format the parser doesn&rsquo;t support.
            </p>
            <p className="field-help">~2 min for a basic client record.</p>
          </button>
        </div>
      </section>

      {orphans.data && orphans.data.length > 0 ? (
        <section className="section">
          <h3 className="mb-3">Resume in-progress imports</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {orphans.data.map((draft) => (
                  <tr key={draft.id}>
                    <td>{draft.upload.filename}</td>
                    <td>{draft.upload.insurerTemplate ?? '—'}</td>
                    <td>
                      <span className="pill pill-muted">{draft.status}</span>
                    </td>
                    <td>{new Date(draft.upload.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="row-end">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            router.push(`/admin/clients/new/import/${draft.upload.id}`)
                          }
                        >
                          Resume →
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function ImportPanel({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadOrphan = trpc.placementSlips.uploadOrphan.useMutation({
    onSuccess: ({ id }) => {
      router.push(`/admin/clients/new/import/${id}`);
    },
    onError: (err) => setError(err.message),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    // Frontend size guard mirrors the backend's assertExcelBuffer
    // 25 MB cap. Catching it here avoids a wasted base64-encode-then-
    // upload round trip and gives the broker a clear error before the
    // request leaves the browser.
    const MAX_BYTES = 25 * 1024 * 1024;
    if (selected.size > MAX_BYTES) {
      setError(
        `File is ${(selected.size / 1024 / 1024).toFixed(1)} MB — exceeds the 25 MB limit. Trim unused sheets or split into multiple uploads.`,
      );
      return;
    }
    if (selected.size === 0) {
      setError('File is empty.');
      return;
    }
    // Light extension guard. The server still magic-byte-sniffs.
    if (!/\.(xls|xlsx)$/i.test(selected.name)) {
      setError('Only .xls or .xlsx workbooks are accepted.');
      return;
    }
    try {
      const contentBase64 = await readFileAsBase64(selected);
      uploadOrphan.mutate({ filename: selected.name, contentBase64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file.');
    }
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-3">Import placement slip</h3>
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="slip-file">
              Excel file (.xls or .xlsx)
            </label>
            <input
              id="slip-file"
              className="input"
              type="file"
              accept=".xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
            />
            <span className="field-help">
              Maximum 25 MB. Parsed synchronously; stored on SharePoint when configured. The wizard
              opens once the upload completes.
            </span>
          </div>

          {error ? <p className="field-error">{error}</p> : null}

          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selected || uploadOrphan.isPending}
            >
              {uploadOrphan.isPending ? 'Uploading…' : 'Start wizard'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}

// Inline manual form — same fields as the legacy /admin/clients
// create surface. Lives here so /admin/clients/new is the single
// canonical entry point.
function ManualPanel({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const countries = trpc.referenceData.countries.useQuery();
  const industries = trpc.referenceData.industries.useQuery();

  const [form, setForm] = useState({
    legalName: '',
    tradingName: '',
    uen: '',
    countryOfIncorporation: 'SG',
    address: '',
    industry: '',
    primaryContactName: '',
    primaryContactEmail: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = trpc.clients.create.useMutation({
    onSuccess: async (created) => {
      await utils.clients.list.invalidate();
      router.push(`/admin/clients/${created.id}/policies`);
    },
    onError: (err) => setError(err.message),
  });

  const selectedCountry = useMemo(
    () => countries.data?.find((c) => c.code === form.countryOfIncorporation) ?? null,
    [countries.data, form.countryOfIncorporation],
  );

  const uenLooksValid = useMemo(() => {
    if (!form.uen) return null;
    if (!selectedCountry?.uenPattern) return null;
    try {
      return new RegExp(selectedCountry.uenPattern).test(form.uen);
    } catch {
      return null;
    }
  }, [form.uen, selectedCountry?.uenPattern]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      legalName: form.legalName.trim(),
      tradingName: form.tradingName.trim() || null,
      uen: form.uen.trim(),
      countryOfIncorporation: form.countryOfIncorporation,
      address: form.address.trim(),
      industry: form.industry || null,
      primaryContactName: form.primaryContactName.trim() || null,
      primaryContactEmail: form.primaryContactEmail.trim() || null,
      status: 'ACTIVE',
    });
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-4">Client details</h3>
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="cli-legal">
              Legal entity name
            </label>
            <input
              id="cli-legal"
              className="input"
              type="text"
              required
              maxLength={200}
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-trading">
              Trading name <span className="field-help-inline">(optional)</span>
            </label>
            <input
              id="cli-trading"
              className="input"
              type="text"
              maxLength={200}
              value={form.tradingName}
              onChange={(e) => setForm({ ...form, tradingName: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-country">
              Country of incorporation
            </label>
            <select
              id="cli-country"
              className="input"
              required
              value={form.countryOfIncorporation}
              onChange={(e) => setForm({ ...form, countryOfIncorporation: e.target.value })}
              disabled={countries.isLoading}
            >
              {countries.data?.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-uen">
              UEN
            </label>
            <input
              id="cli-uen"
              className="input"
              type="text"
              required
              maxLength={40}
              value={form.uen}
              onChange={(e) => setForm({ ...form, uen: e.target.value.toUpperCase() })}
              pattern={selectedCountry?.uenPattern ?? undefined}
            />
            {uenLooksValid === false ? (
              <span className="field-help">
                <strong className="text-error">Does not match expected format.</strong>
              </span>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-address">
              Registered address
            </label>
            <textarea
              id="cli-address"
              className="input"
              required
              maxLength={500}
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-industry">
              Industry (SSIC) <span className="field-help-inline">(optional)</span>
            </label>
            <select
              id="cli-industry"
              className="input"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              disabled={industries.isLoading}
            >
              <option value="">— Select industry —</option>
              {industries.data?.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.code} · {i.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-contact-name">
              Primary contact name <span className="field-help-inline">(optional)</span>
            </label>
            <input
              id="cli-contact-name"
              className="input"
              type="text"
              maxLength={120}
              value={form.primaryContactName}
              onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cli-contact-email">
              Contact email <span className="field-help-inline">(optional)</span>
            </label>
            <input
              id="cli-contact-email"
              className="input"
              type="email"
              maxLength={254}
              value={form.primaryContactEmail}
              onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })}
            />
          </div>

          {error ? <p className="field-error">{error}</p> : null}

          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || uenLooksValid === false}
            >
              {create.isPending ? 'Saving…' : 'Create client'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
