// BenefitGroupsScreen — predicate builder.
// Composes a JSONLogic predicate from rows of (field, operator, value)
// and persists it as a tenant-scoped BenefitGroup.

'use client';

import { ScreenShell } from '@/components/ui';
import {
  type PredicateConnector,
  type PredicateRow,
  jsonLogicToUiPredicate,
  uiPredicateToJsonLogic,
} from '@/lib/predicate';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MatchPreview } from './match-preview';
import { buildRow, uiRowToForm } from './predicate-builder';
import { PredicateRowEditor } from './predicate-row-editor';
import { type EmployeeField, type FormRow, type OperatorRow, emptyRow } from './types';

type FormState = {
  name: string;
  description: string;
  connector: PredicateConnector;
  rows: FormRow[];
};

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  connector: 'and',
  rows: [emptyRow()],
});

export function BenefitGroupsScreen({ policyId }: { policyId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.benefitGroups.listByPolicy.useQuery({ policyId });
  const schema = trpc.employeeSchema.get.useQuery();
  const operators = trpc.referenceData.operators.useQuery();

  const create = trpc.benefitGroups.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm());
      setEditingId(null);
      setFormError(null);
      await utils.benefitGroups.listByPolicy.invalidate({ policyId });
    },
    onError: (err) => setFormError(err.message),
  });
  const update = trpc.benefitGroups.update.useMutation({
    onSuccess: async () => {
      setForm(emptyForm());
      setEditingId(null);
      setFormError(null);
      await utils.benefitGroups.listByPolicy.invalidate({ policyId });
    },
    onError: (err) => setFormError(err.message),
  });
  const remove = trpc.benefitGroups.delete.useMutation({
    onSuccess: () => utils.benefitGroups.listByPolicy.invalidate({ policyId }),
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // S20 — overlap-warning state. Set by checkOverlap during submit when
  // another group's predicate intersects ours; cleared once the user
  // acknowledges or fixes the predicate.
  const [overlapWarning, setOverlapWarning] = useState<{
    overlaps: { id: string; name: string; intersection: number }[];
    noEmployeesYet: boolean;
  } | null>(null);

  // Predicatable fields: STANDARD requires enabled=true; BUILTIN/CUSTOM
  // are always live as long as selectableForPredicates is true.
  const selectableFields = useMemo<EmployeeField[]>(() => {
    if (!schema.data) return [];
    return (schema.data.fields as EmployeeField[]).filter((f) => {
      if (!f.selectableForPredicates) return false;
      if (f.tier === 'STANDARD' && f.enabled === false) return false;
      return true;
    });
  }, [schema.data]);

  // OperatorLibrary returns one row per data type with an operators array.
  // Index by data type so we can pull the right list per row.
  const operatorsByType = useMemo<Record<string, OperatorRow[]>>(() => {
    if (!operators.data) return {};
    const map: Record<string, OperatorRow[]> = {};
    for (const row of operators.data) {
      map[row.dataType] = row.operators as OperatorRow[];
    }
    return map;
  }, [operators.data]);

  const fieldByName = useMemo(() => {
    const m = new Map<string, EmployeeField>();
    for (const f of selectableFields) m.set(f.name, f);
    return m;
  }, [selectableFields]);

  // S19 — derive a JSONLogic preview from the current form. Returns null
  // when the form isn't yet a valid predicate (no rows, missing
  // fields/operators, type mismatches). Re-runs when fields or operators
  // change too, so toggling a STANDARD field off and back on refreshes
  // the preview.
  const previewPredicate = useMemo<unknown | null>(() => {
    if (form.rows.length === 0) return null;
    const rows: PredicateRow[] = [];
    for (const r of form.rows) {
      if (!r.field || !r.operator) return null;
      const field = fieldByName.get(r.field);
      if (!field) return null;
      const op = operatorsByType[field.type]?.find((o) => o.code === r.operator);
      if (!op) return null;
      const built = buildRow(r, field, op);
      if (typeof built === 'string') return null;
      rows.push(built);
    }
    try {
      return uiPredicateToJsonLogic({ connector: form.connector, rows });
    } catch {
      return null;
    }
  }, [form, fieldByName, operatorsByType]);

  // Debounce preview changes by 500ms — avoids hammering the server while
  // the user is mid-keystroke. Only the *value* changes are debounced;
  // field/operator changes still go through this gate.
  const [debouncedPredicate, setDebouncedPredicate] = useState<unknown | null>(null);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedPredicate(previewPredicate), 500);
    return () => window.clearTimeout(handle);
  }, [previewPredicate]);

  const preview = trpc.benefitGroups.evaluate.useQuery(
    debouncedPredicate
      ? { policyId, predicate: debouncedPredicate as Record<string, unknown> }
      : { policyId, predicate: {} as Record<string, unknown> },
    { enabled: debouncedPredicate !== null },
  );

  const updateRow = (index: number, patch: Partial<FormRow>) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({ ...prev, rows: [...prev.rows, emptyRow()] }));
  };

  const removeRow = (index: number) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.length === 1 ? [emptyRow()] : prev.rows.filter((_, i) => i !== index),
    }));
  };

  // Reset form when clicking "New group" after an edit.
  const startNew = () => {
    setForm(emptyForm());
    setEditingId(null);
    setFormError(null);
  };

  // Populate the form from an existing group's stored predicate. Falls
  // back to a single empty row if the predicate doesn't round-trip
  // (e.g. hand-edited deeper nesting).
  const startEdit = (group: {
    id: string;
    name: string;
    description: string | null;
    predicate: unknown;
  }) => {
    setEditingId(group.id);
    setFormError(null);
    const ui = jsonLogicToUiPredicate(group.predicate);
    if (!ui) {
      setForm({
        name: group.name,
        description: group.description ?? '',
        connector: 'and',
        rows: [emptyRow()],
      });
      setFormError(
        'Stored predicate uses advanced JSONLogic that this builder cannot edit. Save will overwrite it.',
      );
      return;
    }
    setForm({
      name: group.name,
      description: group.description ?? '',
      connector: ui.connector,
      rows: ui.rows.map(uiRowToForm),
    });
  };

  // Build the JSONLogic payload from the current form, returning an
  // error string for inline display. Used by both submit and the
  // pre-submit overlap check.
  const buildPredicate = (): { predicate: unknown } | { error: string } => {
    const rows: PredicateRow[] = [];
    for (const r of form.rows) {
      if (!r.field) return { error: 'Pick a field for every condition.' };
      if (!r.operator) return { error: 'Pick an operator for every condition.' };
      const field = fieldByName.get(r.field);
      if (!field) {
        return { error: `Field "${r.field}" no longer exists in the employee schema.` };
      }
      const op = operatorsByType[field.type]?.find((o) => o.code === r.operator);
      if (!op) {
        return { error: `Operator "${r.operator}" doesn't apply to ${field.type} fields.` };
      }
      const built = buildRow(r, field, op);
      if (typeof built === 'string') return { error: built };
      rows.push(built);
    }
    try {
      return { predicate: uiPredicateToJsonLogic({ connector: form.connector, rows }) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to build predicate.' };
    }
  };

  const persist = (predicate: unknown) => {
    const payload = {
      data: {
        name: form.name.trim(),
        description: form.description.trim() || null,
        predicate,
      },
    };
    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      create.mutate({ policyId, ...payload });
    }
  };

  const [checkingOverlap, setCheckingOverlap] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setOverlapWarning(null);

    const built = buildPredicate();
    if ('error' in built) {
      setFormError(built.error);
      return;
    }

    setCheckingOverlap(true);
    try {
      const result = await utils.benefitGroups.checkOverlap.fetch({
        policyId,
        predicate: built.predicate as Record<string, unknown>,
        ...(editingId ? { excludeId: editingId } : {}),
      });
      if (result.overlaps.length > 0) {
        setOverlapWarning({
          overlaps: result.overlaps,
          noEmployeesYet: result.noEmployeesYet,
        });
        return;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to check overlaps.');
      return;
    } finally {
      setCheckingOverlap(false);
    }

    persist(built.predicate);
  };

  // "Save anyway" — user has read the overlap warning and chooses to
  // commit. Skips the check and goes straight to the persist mutation.
  const acknowledgeAndSave = () => {
    setOverlapWarning(null);
    setFormError(null);
    const built = buildPredicate();
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    persist(built.predicate);
  };

  const fieldsLoading = schema.isLoading || operators.isLoading;

  return (
    <ScreenShell title="Benefit groups">
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-4">{editingId ? 'Edit group' : 'Add group'}</h3>
          {fieldsLoading ? (
            <p>Loading employee schema…</p>
          ) : selectableFields.length === 0 ? (
            <p className="field-error">
              No predicate-eligible fields in the employee schema. Toggle a standard field on or add
              a custom field at <Link href="/admin/catalogue/employee-schema">Employee Schema</Link>
              .
            </p>
          ) : (
            <form onSubmit={submit} className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="bg-name">
                  Group name
                </label>
                <input
                  id="bg-name"
                  className="input"
                  type="text"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Senior Management"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="bg-desc">
                  Description <span className="field-help-inline">(optional)</span>
                </label>
                <input
                  id="bg-desc"
                  className="input"
                  type="text"
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {form.rows.length > 1 ? (
                <div className="field">
                  <label className="field-label" htmlFor="bg-conn">
                    Connector
                  </label>
                  <select
                    id="bg-conn"
                    className="input"
                    value={form.connector}
                    onChange={(e) =>
                      setForm({ ...form, connector: e.target.value as PredicateConnector })
                    }
                  >
                    <option value="and">All conditions must match (AND)</option>
                    <option value="or">Any condition matches (OR)</option>
                  </select>
                </div>
              ) : null}

              <fieldset className="fieldset field-span-full">
                <legend>Conditions</legend>
                {form.rows.map((row, idx) => (
                  <PredicateRowEditor
                    key={`row-${idx}-${row.field}`}
                    index={idx}
                    row={row}
                    selectableFields={selectableFields}
                    operatorsByType={operatorsByType}
                    onChange={(patch) => updateRow(idx, patch)}
                    onRemove={() => removeRow(idx)}
                    canRemove={form.rows.length > 1}
                  />
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
                  + Add condition
                </button>
              </fieldset>

              {formError ? <p className="field-error">{formError}</p> : null}

              <div className="card card-padded panel-soft">
                <strong>Live match preview</strong>{' '}
                <MatchPreview
                  ready={previewPredicate !== null}
                  pending={previewPredicate !== debouncedPredicate}
                  loading={preview.isFetching}
                  error={preview.error?.message ?? null}
                  matched={preview.data?.matched ?? null}
                  total={preview.data?.total ?? null}
                />
              </div>

              {overlapWarning ? (
                <div className="card card-padded panel-warn">
                  <strong>⚠️ Predicate overlaps with existing groups</strong>
                  <ul className="mt-2 panel-warn__list">
                    {overlapWarning.overlaps.map((o) => (
                      <li key={o.id}>
                        <strong>{o.name}</strong> — {o.intersection} shared employee
                        {o.intersection === 1 ? '' : 's'}
                      </li>
                    ))}
                  </ul>
                  <p className="field-help mt-2">
                    {overlapWarning.noEmployeesYet
                      ? 'No employees yet — overlap counts will only be accurate after seeding.'
                      : "Employees in two groups will inherit eligibility from both. If that's intentional, save anyway."}
                  </p>
                </div>
              ) : null}

              <div className="row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={create.isPending || update.isPending || checkingOverlap}
                >
                  {checkingOverlap
                    ? 'Checking…'
                    : create.isPending || update.isPending
                      ? 'Saving…'
                      : editingId
                        ? 'Save changes'
                        : 'Add group'}
                </button>
                {overlapWarning ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={acknowledgeAndSave}
                    disabled={create.isPending || update.isPending}
                  >
                    Save anyway
                  </button>
                ) : null}
                {editingId ? (
                  <button type="button" className="btn btn-ghost" onClick={startNew}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Existing groups</h3>
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
                  <th>Description</th>
                  <th>Predicate</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>{g.description ?? '—'}</td>
                    <td>
                      <code className="text-mono-xs">{JSON.stringify(g.predicate)}</code>
                    </td>
                    <td>
                      <div className="row-end">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => startEdit(g)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Delete ${g.name}? This cannot be undone.`)) {
                              remove.mutate({ id: g.id });
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
            <p className="mb-0">No benefit groups yet for this policy.</p>
          </div>
        )}
      </section>
    </ScreenShell>
  );
}
