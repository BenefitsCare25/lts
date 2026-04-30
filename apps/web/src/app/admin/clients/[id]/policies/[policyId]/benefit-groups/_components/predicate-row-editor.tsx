// One predicate row: field dropdown → operator dropdown → value control.

import { useMemo } from 'react';
import type { EmployeeField, FormRow, OperatorRow } from './types';

interface PredicateRowEditorProps {
  index: number;
  row: FormRow;
  selectableFields: EmployeeField[];
  operatorsByType: Record<string, OperatorRow[]>;
  onChange: (patch: Partial<FormRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function PredicateRowEditor({
  index,
  row,
  selectableFields,
  operatorsByType,
  onChange,
  onRemove,
  canRemove,
}: PredicateRowEditorProps) {
  const field = useMemo(
    () => selectableFields.find((f) => f.name === row.field) ?? null,
    [selectableFields, row.field],
  );
  const ops = field ? (operatorsByType[field.type] ?? []) : [];
  const op = useMemo(() => ops.find((o) => o.code === row.operator) ?? null, [ops, row.operator]);
  const arity = op?.arity ?? 'single';

  // Reset operator + value when the user picks a different field. Done in
  // the change handler (not a useEffect) so we don't chase deps across an
  // event-driven reset.
  const onFieldChange = (nextFieldName: string) => {
    onChange({ field: nextFieldName, operator: '', value: '', valueHi: '', valueMulti: [] });
  };

  return (
    <div className="card card-padded mb-3">
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

        <div className="field field-span-2">
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
          <div className="row field-span-full">
            <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove condition
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ValueControlProps {
  id: string;
  field: EmployeeField | null;
  arity: 'single' | 'multi' | 'range';
  row: FormRow;
  onChange: (patch: Partial<FormRow>) => void;
}

function ValueControl({ id, field, arity, row, onChange }: ValueControlProps) {
  if (!field) {
    return <input id={id} className="input" disabled placeholder="Pick a field first" />;
  }

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

  // Single value — by data type.
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
