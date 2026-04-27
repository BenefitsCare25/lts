// =============================================================
// Repeating row of {insurer dropdown, share bps input, remove}.
// Shared between the create and edit forms so the add/remove
// behaviour stays consistent.
// =============================================================

'use client';

import type { Insurer } from '@prisma/client';

export type MemberRow = {
  insurerId: string;
  shareBps: number | null;
};

type Props = {
  members: MemberRow[];
  onChange: (next: MemberRow[]) => void;
  insurers: Insurer[] | undefined;
  insurersLoading: boolean;
};

export function MemberRows({ members, onChange, insurers, insurersLoading }: Props) {
  const addRow = () => onChange([...members, { insurerId: '', shareBps: null }]);
  const removeRow = (idx: number) => onChange(members.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<MemberRow>) =>
    onChange(members.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  if (insurersLoading) {
    return (
      <p style={{ margin: 0 }}>
        <small>Loading insurers…</small>
      </p>
    );
  }

  const availableInsurers = insurers ?? [];
  if (availableInsurers.length === 0) {
    return (
      <p style={{ margin: 0 }}>
        <small>
          No insurers exist yet. <a href="/admin/catalogue/insurers">Add one first</a>.
        </small>
      </p>
    );
  }

  return (
    <div className="stack-3">
      {members.length === 0 ? (
        <p style={{ margin: 0 }}>
          <small>No members yet.</small>
        </p>
      ) : null}

      {members.map((row, idx) => {
        const usedElsewhere = new Set(members.filter((_, i) => i !== idx).map((m) => m.insurerId));
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id before save
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 8rem auto',
              gap: '0.5rem',
              alignItems: 'end',
            }}
          >
            <div className="field">
              {idx === 0 ? <span className="field-label">Insurer</span> : null}
              <select
                className="select"
                value={row.insurerId}
                onChange={(e) => updateRow(idx, { insurerId: e.target.value })}
                required
              >
                <option value="">— Select —</option>
                {availableInsurers.map((ins) => (
                  <option
                    key={ins.id}
                    value={ins.id}
                    disabled={usedElsewhere.has(ins.id) && row.insurerId !== ins.id}
                  >
                    {ins.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              {idx === 0 ? <span className="field-label">Share (bps)</span> : null}
              <input
                className="input"
                type="number"
                min={0}
                max={10000}
                step={1}
                placeholder="optional"
                value={row.shareBps ?? ''}
                onChange={(e) =>
                  updateRow(idx, {
                    shareBps: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(idx)}>
              Remove
            </button>
          </div>
        );
      })}

      <div>
        <button type="button" className="btn btn-sm" onClick={addRow}>
          + Add member
        </button>
        <span className="field-help" style={{ marginLeft: '0.75rem' }}>
          Share is in basis points (10 000 = 100%). Leave blank if unknown.
        </span>
      </div>
    </div>
  );
}
