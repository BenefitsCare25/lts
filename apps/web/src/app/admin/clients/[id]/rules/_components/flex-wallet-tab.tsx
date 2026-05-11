'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useRef, useState } from 'react';

type Row = {
  _key: number;
  flexTierKey: string;
  creditAmount: number;
  tierLabel: string;
  currencyCode: string;
};

export function FlexWalletTab({ benefitYearId }: { benefitYearId: string }) {
  const nextKey = useRef(0);
  const query = trpc.ruleTables.flexWalletRules.list.useQuery({ benefitYearId });
  const upsert = trpc.ruleTables.flexWalletRules.upsertBatch.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    setRows(
      (query.data ?? []).map((r) => ({
        _key: ++nextKey.current,
        flexTierKey: r.flexTierKey,
        creditAmount: Number(r.creditAmount),
        tierLabel: r.tierLabel,
        currencyCode: r.currencyCode,
      })),
    );
    setEditing(true);
  };

  const save = () => {
    upsert.mutate(
      { benefitYearId, rows: rows.filter((r) => r.flexTierKey.trim()).map(({ _key, ...r }) => r) },
      { onSuccess: () => setEditing(false) },
    );
  };

  const addRow = () =>
    setRows([
      ...rows,
      {
        _key: ++nextKey.current,
        flexTierKey: '',
        creditAmount: 0,
        tierLabel: '',
        currencyCode: 'SGD',
      },
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
        <h3 className="text-sm font-medium">Flex Wallet Rules</h3>
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
            <th className="text-left py-2 text-muted-foreground font-normal">Tier Key</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Credits</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Label</th>
            <th className="text-left py-2 text-muted-foreground font-normal">Currency</th>
            {editing && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {!editing &&
            data.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="py-2 font-mono text-xs">{r.flexTierKey}</td>
                <td className="py-2">{Number(r.creditAmount).toLocaleString()}</td>
                <td className="py-2">{r.tierLabel}</td>
                <td className="py-2">{r.currencyCode}</td>
              </tr>
            ))}
          {editing &&
            rows.map((r, i) => (
              <tr key={r._key} className="border-b border-border/50">
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.flexTierKey}
                    onChange={(e) => updateRow(i, { flexTierKey: e.target.value })}
                    placeholder="SINGLE_LOCAL"
                  />
                </td>
                <td className="py-1">
                  <input
                    className="field__input"
                    type="number"
                    value={r.creditAmount}
                    onChange={(e) => updateRow(i, { creditAmount: Number(e.target.value) })}
                  />
                </td>
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.tierLabel}
                    onChange={(e) => updateRow(i, { tierLabel: e.target.value })}
                    placeholder="Single"
                  />
                </td>
                <td className="py-1">
                  <input
                    className="field__input"
                    value={r.currencyCode}
                    onChange={(e) => updateRow(i, { currencyCode: e.target.value })}
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
                No flex wallet rules configured
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
