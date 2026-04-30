// =============================================================
// Employee Schema editor.
//
// One screen, three sections:
//   • Built-in fields — read-only, never removable.
//   • Standard fields — toggleable on/off.
//   • Custom fields — full CRUD with the form below.
//
// Phase 1 keeps everything on one page so admins can see the
// whole schema at once. Splitting into tabs is easy later.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import {
  type CustomFieldInput,
  type EmployeeField,
  FIELD_DATA_TYPES,
  type FieldDataType,
} from '@insurance-saas/shared-types';
import { useState } from 'react';

type FormState = {
  name: string;
  label: string;
  type: FieldDataType;
  required: boolean;
  pii: boolean;
  selectableForPredicates: boolean;
  enumValues: string;
  min: string;
  max: string;
};

const emptyForm: FormState = {
  name: 'employee.',
  label: '',
  type: 'string',
  required: false,
  pii: false,
  selectableForPredicates: true,
  enumValues: '',
  min: '',
  max: '',
};

function buildPayload(form: FormState): CustomFieldInput {
  const payload: CustomFieldInput = {
    name: form.name.trim(),
    label: form.label.trim(),
    type: form.type,
    required: form.required,
    pii: form.pii,
    selectableForPredicates: form.selectableForPredicates,
  };
  if (form.type === 'enum') {
    payload.enumValues = form.enumValues
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  if ((form.type === 'integer' || form.type === 'number') && form.min !== '') {
    payload.min = Number(form.min);
  }
  if ((form.type === 'integer' || form.type === 'number') && form.max !== '') {
    payload.max = Number(form.max);
  }
  return payload;
}

function fieldFormatHint(field: EmployeeField): string {
  if (field.type === 'enum' && field.enumValues) return field.enumValues.join(', ');
  if (
    (field.type === 'integer' || field.type === 'number') &&
    (field.min !== undefined || field.max !== undefined)
  ) {
    return `${field.min ?? '—'} … ${field.max ?? '—'}`;
  }
  return '';
}

export function EmployeeSchemaScreen() {
  const utils = trpc.useUtils();
  const schema = trpc.employeeSchema.get.useQuery();
  const setEnabled = trpc.employeeSchema.setStandardEnabled.useMutation({
    onSuccess: () => utils.employeeSchema.get.invalidate(),
  });
  const addCustom = trpc.employeeSchema.addCustom.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await utils.employeeSchema.get.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });
  const removeCustom = trpc.employeeSchema.removeCustom.useMutation({
    onSuccess: () => utils.employeeSchema.get.invalidate(),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    addCustom.mutate(buildPayload(form));
  };

  if (schema.isLoading) return <p>Loading…</p>;
  if (schema.error) return <p className="field-error">Failed to load: {schema.error.message}</p>;
  if (!schema.data) return null;

  const fields = schema.data.fields as EmployeeField[];
  const builtins = fields.filter((f) => f.tier === 'BUILTIN');
  const standards = fields.filter((f) => f.tier === 'STANDARD');
  const customs = fields.filter((f) => f.tier === 'CUSTOM');

  const isNumeric = form.type === 'integer' || form.type === 'number';

  return (
    <ScreenShell
      title="Employee Schema"
      context={
        <>
          Schema version <code>v{schema.data.version}</code>
        </>
      }
    >
      <section className="section">
        <h3 className="mb-2">Built-in fields</h3>
        <p className="field-help mt-0">Always present. Cannot be disabled or removed.</p>
        <FieldTable rows={builtins} />
      </section>

      <section className="section">
        <h3 className="mb-2">Standard extensions</h3>
        <p className="field-help mt-0">Toggle on or off without losing the definition.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Label</th>
                <th>Type</th>
                <th>Format / values</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {standards.map((field) => (
                <tr key={field.name}>
                  <td>
                    <code>{field.name}</code>
                  </td>
                  <td>{field.label}</td>
                  <td>{field.type}</td>
                  <td>{fieldFormatHint(field) || '—'}</td>
                  <td>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={field.enabled !== false}
                        disabled={setEnabled.isPending}
                        onChange={(e) =>
                          setEnabled.mutate({ name: field.name, enabled: e.target.checked })
                        }
                      />
                      {field.enabled !== false ? 'On' : 'Off'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h3 className="mb-2">Custom fields</h3>
        <p className="field-help mt-0">
          Tenant-specific fields. Names must start with <code>employee.</code> and use lowercase
          letters, digits, underscores.
        </p>

        {customs.length === 0 ? (
          <div className="card card-padded text-center">
            <p className="mb-0">No custom fields yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Format / values</th>
                  <th>Flags</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {customs.map((field) => (
                  <tr key={field.name}>
                    <td>
                      <code>{field.name}</code>
                    </td>
                    <td>{field.label}</td>
                    <td>{field.type}</td>
                    <td>{fieldFormatHint(field) || '—'}</td>
                    <td>
                      <div className="row gap-1">
                        {field.required ? <span className="pill pill-accent">required</span> : null}
                        {field.pii ? <span className="pill pill-accent">PII</span> : null}
                        {field.selectableForPredicates ? (
                          <span className="pill pill-muted">predicate</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="row-end">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Remove ${field.name}?`)) {
                              removeCustom.mutate({ name: field.name });
                            }
                          }}
                          disabled={removeCustom.isPending}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-4">Add custom field</h3>
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="ef-name">
                Name
              </label>
              <input
                id="ef-name"
                className="input"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
                pattern="^employee\.[a-z][a-z0-9_]*$"
                placeholder="employee.hay_job_grade"
              />
              <span className="field-help">
                Must start with <code>employee.</code> e.g. <code>employee.hay_job_grade</code>.
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ef-label">
                Label
              </label>
              <input
                id="ef-label"
                className="input"
                type="text"
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Hay Job Grade"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ef-type">
                Type
              </label>
              <select
                id="ef-type"
                className="select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as FieldDataType })}
              >
                {FIELD_DATA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {form.type === 'enum' ? (
              <div className="field">
                <label className="field-label" htmlFor="ef-enum">
                  Allowed values
                </label>
                <textarea
                  id="ef-enum"
                  className="textarea"
                  value={form.enumValues}
                  onChange={(e) => setForm({ ...form, enumValues: e.target.value })}
                  placeholder={'FLEX_S\nFLEX_M\nFLEX_MC\nFLEX_MC2'}
                />
                <span className="field-help">One per line, or comma-separated.</span>
              </div>
            ) : null}

            {isNumeric ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.75rem',
                }}
              >
                <div className="field">
                  <label className="field-label" htmlFor="ef-min">
                    Min
                  </label>
                  <input
                    id="ef-min"
                    className="input"
                    type="number"
                    value={form.min}
                    onChange={(e) => setForm({ ...form, min: e.target.value })}
                    placeholder="optional"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="ef-max">
                    Max
                  </label>
                  <input
                    id="ef-max"
                    className="input"
                    type="number"
                    value={form.max}
                    onChange={(e) => setForm({ ...form, max: e.target.value })}
                    placeholder="optional"
                  />
                </div>
              </div>
            ) : null}

            <div className="row gap-4">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                />
                Required
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.pii}
                  onChange={(e) => setForm({ ...form, pii: e.target.checked })}
                />
                PII
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.selectableForPredicates}
                  onChange={(e) => setForm({ ...form, selectableForPredicates: e.target.checked })}
                />
                Selectable for predicates
              </label>
            </div>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={addCustom.isPending}>
                {addCustom.isPending ? 'Saving…' : 'Add field'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </ScreenShell>
  );
}

function FieldTable({ rows }: { rows: EmployeeField[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Label</th>
            <th>Type</th>
            <th>Format / values</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((field) => (
            <tr key={field.name}>
              <td>
                <code>{field.name}</code>
              </td>
              <td>{field.label}</td>
              <td>{field.type}</td>
              <td>{fieldFormatHint(field) || '—'}</td>
              <td>
                <div className="row gap-1">
                  {field.required ? <span className="pill pill-accent">required</span> : null}
                  {field.pii ? <span className="pill pill-accent">PII</span> : null}
                  {field.computed ? <span className="pill pill-muted">computed</span> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
