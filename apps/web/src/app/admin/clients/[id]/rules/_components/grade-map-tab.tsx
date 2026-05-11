'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useRef, useState } from 'react';

const BANDS = ['LOW', 'MID', 'HIGH', 'SENIOR', 'EXEC'] as const;

type Row = { _key: number; gradeCode: string; standardBand: string };

export function GradeMapTab({ benefitYearId }: { benefitYearId: string }) {
  const nextKey = useRef(0);
  const query = trpc.ruleTables.gradeMap.list.useQuery({ benefitYearId });
  const upsert = trpc.ruleTables.gradeMap.upsertBatch.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    setRows(
      (query.data ?? []).map((r) => ({
        _key: ++nextKey.current,
        gradeCode: r.gradeCode,
        standardBand: r.standardBand,
      })),
    );
    setEditing(true);
  };

  const save = () => {
    const valid = rows.filter((r) => r.gradeCode.trim());
    upsert.mutate(
      {
        benefitYearId,
        rows: valid.map(({ _key, ...r }) => ({
          gradeCode: r.gradeCode,
          standardBand: r.standardBand as (typeof BANDS)[number],
        })),
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const addRow = () =>
    setRows([...rows, { _key: ++nextKey.current, gradeCode: '', standardBand: 'LOW' }]);

  const removeRow = (index: number) => setRows(rows.filter((_, i) => i !== index));

  const updateRow = (index: number, field: keyof Row, value: string) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  if (query.isLoading)
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );

  const data = query.data ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Grade Normalisation Map</h3>
        {!editing && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={startEdit}>
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button type="button" className="btn btn--secondary btn--sm" onClick={addRow}>
              Add Row
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={save}
              disabled={upsert.isPending}
            >
              {upsert.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 text-muted-foreground font-normal">Grade Code</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Standard Band</th>
            {editing && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {!editing &&
            data.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="py-2">{r.gradeCode}</td>
                <td className="py-2">{r.standardBand}</td>
              </tr>
            ))}
          {editing &&
            rows.map((r, i) => (
              <tr key={r._key} className="border-b border-border/50">
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.gradeCode}
                    onChange={(e) => updateRow(i, 'gradeCode', e.target.value)}
                    placeholder="e.g. 8, A1, MSH"
                  />
                </td>
                <td className="py-1">
                  <select
                    className="field__input"
                    value={r.standardBand}
                    onChange={(e) => updateRow(i, 'standardBand', e.target.value)}
                  >
                    {BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    className="text-red-500 text-xs"
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          {!editing && data.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-center text-muted-foreground">
                No grade map configured
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
