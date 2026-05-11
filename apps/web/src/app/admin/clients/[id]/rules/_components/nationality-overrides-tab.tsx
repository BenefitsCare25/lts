'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useRef, useState } from 'react';

const BANDS = ['LOW', 'MID', 'HIGH', 'SENIOR', 'EXEC'] as const;

type Row = {
  _key: number;
  nationality: string;
  standardBand: string;
  productId: string;
  planId: string;
};

export function NationalityOverridesTab({ benefitYearId }: { benefitYearId: string }) {
  const nextKey = useRef(0);
  const query = trpc.ruleTables.nationalityOverrides.list.useQuery({ benefitYearId });
  const upsert = trpc.ruleTables.nationalityOverrides.upsertBatch.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    setRows(
      (query.data ?? []).map((r) => ({
        _key: ++nextKey.current,
        nationality: r.nationality,
        standardBand: r.standardBand,
        productId: r.productId,
        planId: r.planId,
      })),
    );
    setEditing(true);
  };

  const save = () => {
    upsert.mutate(
      {
        benefitYearId,
        rows: rows
          .filter((r) => r.nationality.trim())
          .map(({ _key, ...r }) => ({
            ...r,
            standardBand: r.standardBand as (typeof BANDS)[number],
          })),
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const addRow = () =>
    setRows([
      ...rows,
      { _key: ++nextKey.current, nationality: '', standardBand: 'LOW', productId: '', planId: '' },
    ]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, updates: Partial<Row>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...updates } : r)));

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
        <h3 className="text-sm font-medium">Nationality Overrides</h3>
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
            <th className="text-left py-2 text-muted-foreground font-normal">Nationality</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Band</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Product ID</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Plan ID</th>
            {editing && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {!editing &&
            data.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="py-2">{r.nationality}</td>
                <td className="py-2">{r.standardBand}</td>
                <td className="py-2 font-mono text-xs">{r.productId.slice(0, 8)}</td>
                <td className="py-2 font-mono text-xs">{r.planId.slice(0, 8)}</td>
              </tr>
            ))}
          {editing &&
            rows.map((r, i) => (
              <tr key={r._key} className="border-b border-border/50">
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.nationality}
                    onChange={(e) => updateRow(i, { nationality: e.target.value })}
                    placeholder="AU, ID, PK"
                  />
                </td>
                <td className="py-1">
                  <select
                    className="field__input"
                    value={r.standardBand}
                    onChange={(e) => updateRow(i, { standardBand: e.target.value })}
                  >
                    {BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.productId}
                    onChange={(e) => updateRow(i, { productId: e.target.value })}
                  />
                </td>
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.planId}
                    onChange={(e) => updateRow(i, { planId: e.target.value })}
                  />
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
              <td colSpan={4} className="py-4 text-center text-muted-foreground">
                No nationality overrides configured
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
