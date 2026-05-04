'use client';

import { formatDate } from '@/lib/format-date';
import { trpc } from '@/lib/trpc/client';
import type { EmployeeField } from '@insurance-saas/shared-types';
import { useState } from 'react';

function labelFor(key: string, fields: EmployeeField[]): string {
  const field = fields.find((f) => f.name === key);
  if (field) return field.label;
  return key.replace(/^employee\./, '').replace(/_/g, ' ');
}

function formatValue(key: string, value: unknown, fields: EmployeeField[]): string {
  if (value == null) return '—';
  const field = fields.find((f) => f.name === key);
  if (field?.type === 'date' && typeof value === 'string') return formatDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: EmployeeField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === 'enum' && field.enumValues?.length) {
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        id={field.name}
      >
        <option value="">— select —</option>
        {field.enumValues.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'boolean') {
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        id={field.name}
      >
        <option value="">— select —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      id={field.name}
      type={
        field.type === 'date'
          ? 'date'
          : field.type === 'integer' || field.type === 'number'
            ? 'number'
            : 'text'
      }
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ProfileScreen() {
  const { data, isLoading, error } = trpc.portal.profile.get.useQuery();
  const updateMutation = trpc.portal.profile.update.useMutation();
  const utils = trpc.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  if (isLoading) return <p className="muted">Loading your profile…</p>;
  if (error) return <p className="field-error">{error.message}</p>;
  if (!data) return null;

  const fields = (data.schema as EmployeeField[] | null) ?? [];
  const empData = (data.data ?? {}) as Record<string, unknown>;

  const visibleEntries = Object.entries(empData).filter(
    ([k]) => !k.startsWith('_') && !k.startsWith('employee._'),
  );

  const editableFields = fields.filter((f) => f.employeeEditable);
  const editableNames = new Set(editableFields.map((f) => f.name));
  const nonEditableEntries = visibleEntries.filter(([k]) => !editableNames.has(k));

  function startEditing() {
    const initial: Record<string, string> = {};
    for (const f of editableFields) {
      const v = empData[f.name];
      initial[f.name] = v == null ? '' : String(v);
    }
    setFormValues(initial);
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    setSaveError(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(formValues)) {
      const field = editableFields.find((f) => f.name === k);
      if (!field) continue;
      if (v === '') continue; // omit blank — don't overwrite with empty
      if (field.type === 'boolean') payload[k] = v === 'true';
      else if (field.type === 'integer') payload[k] = Number.parseInt(v, 10);
      else if (field.type === 'number') payload[k] = Number.parseFloat(v);
      else payload[k] = v;
    }
    try {
      await updateMutation.mutateAsync({ data: payload });
      await utils.portal.profile.get.invalidate();
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card card-padded">
        <h3 className="text-sm font-semibold mb-3">Employment Details</h3>
        <dl className="field-dl">
          <div className="field-dl__row">
            <dt className="field-dl__label">Status</dt>
            <dd className="field-dl__value">{data.status}</dd>
          </div>
          <div className="field-dl__row">
            <dt className="field-dl__label">Hire date</dt>
            <dd className="field-dl__value">{formatDate(data.hireDate)}</dd>
          </div>
          {data.terminationDate && (
            <div className="field-dl__row">
              <dt className="field-dl__label">Termination date</dt>
              <dd className="field-dl__value">{formatDate(data.terminationDate)}</dd>
            </div>
          )}
        </dl>
      </div>

      {(nonEditableEntries.length > 0 || editableFields.length > 0) && (
        <div className="card card-padded">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Personal Information</h3>
            {editableFields.length > 0 && !isEditing && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={startEditing}>
                Edit
              </button>
            )}
          </div>

          {nonEditableEntries.length > 0 && (
            <dl className="field-dl mb-4">
              {nonEditableEntries.map(([k, v]) => (
                <div key={k} className="field-dl__row">
                  <dt className="field-dl__label">{labelFor(k, fields)}</dt>
                  <dd className="field-dl__value">{formatValue(k, v, fields)}</dd>
                </div>
              ))}
            </dl>
          )}
          {editableFields.length > 0 &&
            (isEditing ? (
              <div className="flex flex-col gap-3">
                {editableFields.map((f) => (
                  <div key={f.name} className="field">
                    <label className="field-label" htmlFor={f.name}>
                      {f.label}
                    </label>
                    <FieldInput
                      field={f}
                      value={formValues[f.name] ?? ''}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [f.name]: v }))}
                    />
                  </div>
                ))}
                {saveError && <p className="field-error">{saveError}</p>}
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsEditing(false)}
                    disabled={updateMutation.isPending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <dl className="field-dl">
                {editableFields.map((f) => (
                  <div key={f.name} className="field-dl__row">
                    <dt className="field-dl__label">{f.label}</dt>
                    <dd className="field-dl__value">
                      {formatValue(f.name, empData[f.name], fields)}
                    </dd>
                  </div>
                ))}
              </dl>
            ))}
        </div>
      )}
    </div>
  );
}
