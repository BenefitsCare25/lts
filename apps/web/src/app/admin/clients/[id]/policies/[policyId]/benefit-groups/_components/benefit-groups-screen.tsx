// =============================================================
// BenefitGroupsScreen — Screen 4 (S18) predicate builder.
//
// The list shows existing groups under the policy. The form lets
// the broker compose a predicate: pick a field from the tenant's
// EmployeeSchema (only `selectableForPredicates` + `enabled`
// fields), then an operator filtered by the field's data type from
// the OperatorLibrary, then a value control whose shape switches
// by data type (number with min/max, enum multiselect, boolean
// toggle, date picker, free text). Multiple rows compose into an
// AND/OR group; saved as JSONLogic.
// =============================================================

'use client';

import {
  type PredicateConnector,
  type PredicateRow,
  jsonLogicToUiPredicate,
  uiPredicateToJsonLogic,
} from '@/lib/predicate';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type EmployeeField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  pii: boolean;
  selectableForPredicates: boolean;
  enabled?: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  tier: string;
};

type OperatorRow = {
  code: string;
  label: string;
  arity: 'single' | 'multi' | 'range';
};

type FormRow = {
  field: string;
  operator: string;
  // String-encoded value(s); typed and parsed at submit time.
  value: string;
  // For "between" range; otherwise unused.
  valueHi: string;
  // For "in"/"notIn" multiselect; otherwise unused.
  valueMulti: string[];
};

type FormState = {
  name: string;
  description: string;
  connector: PredicateConnector;
  rows: FormRow[];
};

const emptyRow = (): FormRow => ({
  field: '',
  operator: '',
  value: '',
  valueHi: '',
  valueMulti: [],
});

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  connector: 'and',
  rows: [emptyRow()],
});

// Cast a string input to the JS value the field type expects.
const coerce = (raw: string, type: string): unknown => {
  if (type === 'integer') return Number.parseInt(raw, 10);
  if (type === 'number') return Number.parseFloat(raw);
  if (type === 'boolean') return raw === 'true';
  // string, enum, date — kept as string (date stays as YYYY-MM-DD ISO).
  return raw;
};

export function BenefitGroupsScreen({
  clientId,
  policyId,
}: {
  clientId: string;
  policyId: string;
}) {
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

  // OperatorLibrary returns one row per data type with an operators
  // array. Index by data type so we can pull the right list per row.
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

  // Populate the form from an existing group's stored predicate.
  // Falls back to a single empty row if the predicate doesn't
  // round-trip (e.g. hand-edited deeper nesting).
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validate every row before building JSONLogic.
    const rows: PredicateRow[] = [];
    for (const r of form.rows) {
      if (!r.field) {
        setFormError('Pick a field for every condition.');
        return;
      }
      if (!r.operator) {
        setFormError('Pick an operator for every condition.');
        return;
      }
      const field = fieldByName.get(r.field);
      if (!field) {
        setFormError(`Field "${r.field}" no longer exists in the employee schema.`);
        return;
      }
      const op = operatorsByType[field.type]?.find((o) => o.code === r.operator);
      if (!op) {
        setFormError(`Operator "${r.operator}" doesn't apply to ${field.type} fields.`);
        return;
      }
      const built = buildRow(r, field, op);
      if (typeof built === 'string') {
        setFormError(built);
        return;
      }
      rows.push(built);
    }

    let predicate: unknown;
    try {
      predicate = uiPredicateToJsonLogic({ connector: form.connector, rows });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to build predicate.');
      return;
    }

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

  const fieldsLoading = schema.isLoading || operators.isLoading;

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href={`/admin/clients/${clientId}/policies/${policyId}/edit`}>← Policy</Link>
        </p>
        <h1>Benefit groups</h1>
        <p style={{ maxWidth: '60ch' }}>
          Each benefit group is a JSONLogic predicate that classifies employees into a cohort (e.g.
          "Senior management born before 1970", "Foreign workers on Work Permit"). Groups drive the
          eligibility matrix on per-product configuration (Screen 5c).
        </p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <h3 style={{ marginBottom: '1rem' }}>{editingId ? 'Edit group' : 'Add group'}</h3>
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

              <fieldset className="fieldset" style={{ gridColumn: '1 / -1' }}>
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

              <div className="row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={create.isPending || update.isPending}
                >
                  {create.isPending || update.isPending
                    ? 'Saving…'
                    : editingId
                      ? 'Save changes'
                      : 'Add group'}
                </button>
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
        <h3 style={{ marginBottom: '0.75rem' }}>Existing groups</h3>
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
                      <code style={{ fontSize: 'var(--font-md, 12px)' }}>
                        {JSON.stringify(g.predicate)}
                      </code>
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
          <div className="card card-padded" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 0 }}>No benefit groups yet for this policy.</p>
          </div>
        )}
      </section>
    </>
  );
}

// One predicate row: field dropdown → operator dropdown → value control.
function PredicateRowEditor({
  index,
  row,
  selectableFields,
  operatorsByType,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  row: FormRow;
  selectableFields: EmployeeField[];
  operatorsByType: Record<string, OperatorRow[]>;
  onChange: (patch: Partial<FormRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const field = useMemo(
    () => selectableFields.find((f) => f.name === row.field) ?? null,
    [selectableFields, row.field],
  );
  const ops = field ? (operatorsByType[field.type] ?? []) : [];
  const op = useMemo(() => ops.find((o) => o.code === row.operator) ?? null, [ops, row.operator]);
  const arity = op?.arity ?? 'single';

  // Reset operator + value when the user picks a different field. Done
  // here in the change handler (not via useEffect) so we don't need
  // to chase deps across an event-driven reset.
  const onFieldChange = (nextFieldName: string) => {
    onChange({ field: nextFieldName, operator: '', value: '', valueHi: '', valueMulti: [] });
  };

  return (
    <div className="card card-padded" style={{ marginBottom: '0.75rem' }}>
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor={`row-${index}-field`}>
            Field
          </label>
          <select
            id={`row-${index}-field`}
            className="input"
            required
            value={row.field}
            onChange={(e) => onFieldChange(e.target.value)}
          >
            <option value="">— Select field —</option>
            {selectableFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label} ({f.type})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`row-${index}-op`}>
            Operator
          </label>
          <select
            id={`row-${index}-op`}
            className="input"
            required
            value={row.operator}
            onChange={(e) =>
              onChange({ operator: e.target.value, value: '', valueHi: '', valueMulti: [] })
            }
            disabled={!field}
          >
            <option value="">{field ? '— Select operator —' : '— Pick a field first —'}</option>
            {ops.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label className="field-label" htmlFor={`row-${index}-val`}>
            Value
          </label>
          <ValueControl
            id={`row-${index}-val`}
            field={field}
            arity={arity}
            row={row}
            onChange={onChange}
          />
        </div>

        {canRemove ? (
          <div className="row" style={{ gridColumn: '1 / -1' }}>
            <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove condition
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ValueControl({
  id,
  field,
  arity,
  row,
  onChange,
}: {
  id: string;
  field: EmployeeField | null;
  arity: 'single' | 'multi' | 'range';
  row: FormRow;
  onChange: (patch: Partial<FormRow>) => void;
}) {
  if (!field) {
    return <input id={id} className="input" disabled placeholder="Pick a field first" />;
  }

  // Range (between): two inputs of the field's type
  if (arity === 'range') {
    return (
      <div className="row">
        <input
          id={id}
          className="input"
          type={field.type === 'date' ? 'date' : 'number'}
          required
          {...(field.type === 'integer' || field.type === 'number'
            ? { min: field.min, max: field.max, step: field.type === 'integer' ? 1 : 'any' }
            : {})}
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="From"
        />
        <span>→</span>
        <input
          className="input"
          type={field.type === 'date' ? 'date' : 'number'}
          required
          {...(field.type === 'integer' || field.type === 'number'
            ? { min: field.min, max: field.max, step: field.type === 'integer' ? 1 : 'any' }
            : {})}
          value={row.valueHi}
          onChange={(e) => onChange({ valueHi: e.target.value })}
          placeholder="To"
        />
      </div>
    );
  }

  // Multi (in / notIn): checkbox group for enums; comma-separated string otherwise
  if (arity === 'multi') {
    if (field.type === 'enum' && field.enumValues) {
      return (
        <div className="chip-group">
          {field.enumValues.map((v) => {
            const checked = row.valueMulti.includes(v);
            return (
              <label key={v} className="chip">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      valueMulti: checked
                        ? row.valueMulti.filter((x) => x !== v)
                        : [...row.valueMulti, v],
                    })
                  }
                />
                {v}
              </label>
            );
          })}
        </div>
      );
    }
    return (
      <input
        id={id}
        className="input"
        type="text"
        required
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="Comma-separated values"
      />
    );
  }

  // Single value — by data type
  if (field.type === 'enum' && field.enumValues) {
    return (
      <select
        id={id}
        className="input"
        required
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="">— Select —</option>
        {field.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'boolean') {
    return (
      <select
        id={id}
        className="input"
        required
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="">— Select —</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }
  if (field.type === 'date') {
    return (
      <input
        id={id}
        className="input"
        type="date"
        required
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    );
  }
  if (field.type === 'integer' || field.type === 'number') {
    return (
      <input
        id={id}
        className="input"
        type="number"
        required
        min={field.min}
        max={field.max}
        step={field.type === 'integer' ? 1 : 'any'}
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    );
  }
  // string
  return (
    <input
      id={id}
      className="input"
      type="text"
      required
      value={row.value}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  );
}

// Convert a UI form row into a typed PredicateRow ready for JSONLogic
// translation, or return an error string for inline display.
function buildRow(row: FormRow, field: EmployeeField, op: OperatorRow): PredicateRow | string {
  if (op.arity === 'range') {
    if (!row.value || !row.valueHi) return 'Range operator needs both lower and upper values.';
    return {
      field: row.field,
      operator: row.operator,
      value: [coerce(row.value, field.type), coerce(row.valueHi, field.type)],
    };
  }
  if (op.arity === 'multi') {
    let values: unknown[];
    if (field.type === 'enum') {
      if (row.valueMulti.length === 0) return 'Pick at least one value.';
      values = row.valueMulti;
    } else {
      values = row.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => coerce(s, field.type));
      if (values.length === 0) return 'Provide at least one value.';
    }
    return { field: row.field, operator: row.operator, value: values };
  }
  // single
  if (row.value === '') return 'Value is required.';
  return { field: row.field, operator: row.operator, value: coerce(row.value, field.type) };
}

function uiRowToForm(row: PredicateRow): FormRow {
  // Arity is implicit in the value shape when round-tripping
  if (Array.isArray(row.value) && row.operator === 'between' && row.value.length === 2) {
    return {
      field: row.field,
      operator: row.operator,
      value: String(row.value[0]),
      valueHi: String(row.value[1]),
      valueMulti: [],
    };
  }
  if (Array.isArray(row.value)) {
    return {
      field: row.field,
      operator: row.operator,
      value: row.value.join(', '),
      valueHi: '',
      valueMulti: row.value.map(String),
    };
  }
  return {
    field: row.field,
    operator: row.operator,
    value: row.value === null || row.value === undefined ? '' : String(row.value),
    valueHi: '',
    valueMulti: [],
  };
}
