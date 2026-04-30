// =============================================================
// EmployeesScreen — list + add form + CSV import.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Form from '@rjsf/core';
import type { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useState } from 'react';

const formatDate = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};

// Pulls a string identifier from Employee.data — uses full_name by
// default but falls back to any string field so the row stays readable.
function displayLabel(data: Record<string, unknown>): string {
  const fullName = data['employee.full_name'];
  if (typeof fullName === 'string' && fullName) return fullName;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '(no name)';
}

export function EmployeesScreen({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.employees.listByClient.useQuery({ clientId });
  const schemaQ = trpc.employees.schemaForForm.useQuery();

  const create = trpc.employees.create.useMutation({
    onSuccess: async () => {
      setFormData({});
      setHireDate('');
      setSaveError(null);
      await utils.employees.listByClient.invalidate({ clientId });
    },
    onError: (err) => setSaveError(err.message),
  });
  const remove = trpc.employees.delete.useMutation({
    onSuccess: () => utils.employees.listByClient.invalidate({ clientId }),
  });
  const importCsv = trpc.employees.importCsv.useMutation({
    onSuccess: async (res) => {
      setImportResult(res);
      await utils.employees.listByClient.invalidate({ clientId });
    },
    onError: (err) => setImportError(err.message),
  });

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [hireDate, setHireDate] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // CSV import state.
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHireField, setCsvHireField] = useState('employee.hire_date');
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    createdCount: number;
    failures: { rowIndex: number; reason: string }[];
  } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    if (!hireDate) {
      setSaveError('Hire date is required.');
      return;
    }
    create.mutate({
      clientId,
      data: formData,
      status: 'ACTIVE',
      hireDate: new Date(hireDate),
      terminationDate: null,
    });
  };

  const submitCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    setImportResult(null);
    if (!csvFile) return;
    try {
      const text = await csvFile.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setImportError('CSV must have a header row and at least one data row.');
        return;
      }
      const firstLine = lines[0];
      if (!firstLine) {
        setImportError('CSV header row is empty.');
        return;
      }
      const headers = firstLine.split(',').map((h) => h.trim());
      const rows = lines.slice(1).map((l) => {
        const cells = l.split(',').map((c) => c.trim());
        const row: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          row[h] = cells[i] ?? '';
        });
        return row;
      });
      importCsv.mutate({ clientId, rows, hireDateField: csvHireField });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'CSV parse failed.');
    }
  };

  return (
    <ScreenShell title="Employees">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-2">New employee</h3>
          {schemaQ.isLoading ? (
            <p>Loading schema…</p>
          ) : schemaQ.error ? (
            <p className="field-error">Failed to load schema: {schemaQ.error.message}</p>
          ) : schemaQ.data ? (
            <form onSubmit={submit}>
              <Form
                schema={schemaQ.data as RJSFSchema}
                formData={formData}
                validator={validator}
                onChange={({ formData: next }) =>
                  setFormData((next ?? {}) as Record<string, unknown>)
                }
                onSubmit={() => {
                  /* submission handled by the outer form */
                }}
                uiSchema={{ 'ui:submitButtonOptions': { norender: true } }}
              />
              <div className="field" style={{ maxWidth: '14rem' }}>
                <label className="field-label" htmlFor="emp-hire">
                  Hire date
                </label>
                <input
                  id="emp-hire"
                  className="input"
                  type="date"
                  required
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                />
              </div>
              {saveError ? <p className="field-error">{saveError}</p> : null}
              <div className="row">
                <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                  {create.isPending ? 'Saving…' : 'Add employee'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-2">CSV import</h3>
          <p className="field-help mb-3">
            CSV header row maps to employee schema fields by exact name (e.g.{' '}
            <code>employee.full_name</code>, <code>employee.hire_date</code>). Rows that fail
            validation are reported back without creating partial records.
          </p>
          <form onSubmit={submitCsv} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="csv-file">
                CSV file
              </label>
              <input
                id="csv-file"
                className="input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="csv-hire">
                Hire date column
              </label>
              <input
                id="csv-hire"
                className="input"
                type="text"
                value={csvHireField}
                onChange={(e) => setCsvHireField(e.target.value)}
              />
            </div>
            {importError ? <p className="field-error">{importError}</p> : null}
            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!csvFile || importCsv.isPending}
              >
                {importCsv.isPending ? 'Importing…' : 'Import CSV'}
              </button>
            </div>
          </form>
          {importResult ? (
            <div className="mt-4">
              <p>
                <strong>{importResult.createdCount}</strong> created,{' '}
                <strong>{importResult.failures.length}</strong> failed.
              </p>
              {importResult.failures.length > 0 ? (
                <ul>
                  {importResult.failures.map((f) => (
                    <li key={f.rowIndex} className="text-error">
                      Row {f.rowIndex + 2}: {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Existing employees ({list.data?.length ?? 0})</h3>
        {list.isLoading ? (
          <p>Loading…</p>
        ) : list.error ? (
          <p className="field-error">Failed to load: {list.error.message}</p>
        ) : list.data && list.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Hire date</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <td>{displayLabel(e.data as Record<string, unknown>)}</td>
                    <td>
                      <span
                        className={e.status === 'ACTIVE' ? 'pill pill-success' : 'pill pill-muted'}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td>{formatDate(e.hireDate)}</td>
                    <td>
                      <div className="row-end">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm('Delete this employee?')) {
                              remove.mutate({ id: e.id });
                            }
                          }}
                          disabled={remove.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-padded text-center">
            <p className="mb-0">No employees yet.</p>
          </div>
        )}
      </section>
    </ScreenShell>
  );
}
