'use client';

import { Card } from '@/components/ui';
import { employeeDisplayLabel } from '@/lib/employee-display';
import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';

export function ErrorQueueTab({ benefitYearId }: { benefitYearId: string }) {
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'RESOLVED' | 'IGNORED' | ''>('OPEN');
  const [engineFilter, setEngineFilter] = useState<string>('');

  const changeStatusFilter = (value: typeof statusFilter) => {
    setStatusFilter(value);
    setSelected(new Set());
  };
  const changeEngineFilter = (value: string) => {
    setEngineFilter(value);
    setSelected(new Set());
  };

  const query = trpc.ruleTables.processingErrors.list.useQuery({
    benefitYearId,
    status: statusFilter || undefined,
    engine: engineFilter || undefined,
  });
  const resolve = trpc.ruleTables.processingErrors.resolve.useMutation({
    onSuccess: () => query.refetch(),
  });
  const ignore = trpc.ruleTables.processingErrors.ignore.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    const ids = (query.data ?? []).map((e) => e.id);
    setSelected(new Set(ids));
  };

  const handleResolve = () => {
    if (selected.size === 0) return;
    resolve.mutate({ ids: [...selected] }, { onSuccess: () => setSelected(new Set()) });
  };

  const handleIgnore = () => {
    if (selected.size === 0) return;
    ignore.mutate({ ids: [...selected] }, { onSuccess: () => setSelected(new Set()) });
  };

  const data = query.data ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Processing Errors</h3>
        <div className="flex items-center gap-2">
          <select
            className="field__input"
            value={statusFilter}
            onChange={(e) => changeStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="IGNORED">Ignored</option>
          </select>
          <select
            className="field__input"
            value={engineFilter}
            onChange={(e) => changeEngineFilter(e.target.value)}
          >
            <option value="">All engines</option>
            <option value="INSURANCE_PLAN">Insurance Plan</option>
            <option value="FLEX_WALLET">Flex Wallet</option>
          </select>
          {selected.size > 0 && (
            <>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleResolve}
                disabled={resolve.isPending}
              >
                Resolve ({selected.size})
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleIgnore}
                disabled={ignore.isPending}
              >
                Ignore ({selected.size})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) selectAll();
                    else setSelected(new Set());
                  }}
                  checked={selected.size > 0 && selected.size === data.length}
                />
              </th>
              <th className="text-left py-2 text-muted-foreground font-normal">Engine</th>
              <th className="text-left py-2 text-muted-foreground font-normal">Error Code</th>
              <th className="text-left py-2 text-muted-foreground font-normal">Message</th>
              <th className="text-left py-2 text-muted-foreground font-normal">Employee</th>
              <th className="text-left py-2 text-muted-foreground font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((err) => (
              <tr key={err.id} className="border-b border-border/50">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(err.id)}
                    onChange={() => toggle(err.id)}
                  />
                </td>
                <td className="py-2">{err.engine}</td>
                <td className="py-2 font-mono text-xs">{err.errorCode}</td>
                <td className="py-2 text-xs max-w-xs truncate" title={err.errorMessage}>
                  {err.errorMessage}
                </td>
                <td className="py-2 text-xs" title={err.employeeId}>
                  {employeeDisplayLabel((err.employeeSnapshot as Record<string, unknown>) ?? {})}
                </td>
                <td className="py-2">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      err.status === 'OPEN'
                        ? 'bg-red-100 text-red-700'
                        : err.status === 'RESOLVED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {err.status}
                  </span>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  No processing errors
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
