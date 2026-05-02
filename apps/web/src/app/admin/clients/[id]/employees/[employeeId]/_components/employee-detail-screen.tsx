'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

type Tab = 'profile' | 'entitlements';

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function displayName(data: Record<string, unknown>): string {
  const n = data['employee.full_name'];
  if (typeof n === 'string' && n) return n;
  return '(no name)';
}

export function EmployeeDetailScreen({
  clientId,
  employeeId,
}: {
  clientId: string;
  employeeId: string;
}) {
  const [tab, setTab] = useState<Tab>('profile');

  const empQ = trpc.employees.byId.useQuery({ id: employeeId });
  const entQ = trpc.employees.entitlements.useQuery({ employeeId });

  const employee = empQ.data;
  const data = (employee?.data ?? {}) as Record<string, unknown>;

  return (
    <ScreenShell
      title={employee ? displayName(data) : 'Employee'}
      context={
        employee
          ? `Hire date: ${formatDate(employee.hireDate)} · Status: ${employee.status}`
          : undefined
      }
      actions={
        <Link href={`/admin/clients/${clientId}/employees`} className="btn btn-secondary">
          Back
        </Link>
      }
    >
      <nav className="tab-row mb-4">
        <button
          type="button"
          className={`tab-btn${tab === 'profile' ? ' tab-btn--active' : ''}`}
          onClick={() => setTab('profile')}
        >
          Profile
        </button>
        <button
          type="button"
          className={`tab-btn${tab === 'entitlements' ? ' tab-btn--active' : ''}`}
          onClick={() => setTab('entitlements')}
        >
          Entitlements
        </button>
      </nav>

      {tab === 'profile' && (
        <ProfileTab
          loading={empQ.isLoading}
          {...(empQ.error ? { error: empQ.error.message } : {})}
          data={data}
        />
      )}
      {tab === 'entitlements' && (
        <EntitlementsTab
          loading={entQ.isLoading}
          {...(entQ.error ? { error: entQ.error.message } : {})}
          {...(entQ.data !== undefined ? { rows: entQ.data } : {})}
        />
      )}
    </ScreenShell>
  );
}

function ProfileTab({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error?: string;
  data: Record<string, unknown>;
}) {
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="field-error">{error}</p>;

  const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return <p className="muted">No profile fields recorded.</p>;

  return (
    <div className="card card-padded">
      <dl className="field-dl">
        {entries.map(([k, v]) => (
          <div key={k} className="field-dl__row">
            <dt className="field-dl__label">{k.replace('employee.', '').replace(/_/g, ' ')}</dt>
            <dd className="field-dl__value">{v == null ? '—' : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type EntitlementRow = {
  enrollmentId: string;
  productTypeCode: string | null;
  productTypeName: string | null;
  planCode: string | null;
  planName: string | null;
  coverBasis: string | null;
  benefitGroupName: string | null;
  coverTier: string | null;
  effectiveFrom: Date | string;
  rate: { ratePerThousand: number | null; fixedAmount: number | null } | null;
};

function EntitlementsTab({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error?: string;
  rows?: EntitlementRow[];
}) {
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (!rows || rows.length === 0) {
    return (
      <div className="card card-padded">
        <p className="muted">No active enrollments for this employee.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <EntitlementCard key={row.enrollmentId} row={row} />
      ))}
    </div>
  );
}

function EntitlementCard({ row }: { row: EntitlementRow }) {
  const rateLabel = () => {
    if (!row.rate) return '—';
    if (row.rate.fixedAmount != null) return `$${row.rate.fixedAmount.toFixed(2)}/yr`;
    if (row.rate.ratePerThousand != null)
      return `$${row.rate.ratePerThousand.toFixed(4)} per $1,000 SI`;
    return '—';
  };

  return (
    <div className="card card-padded">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-medium">
          {row.productTypeName ?? row.productTypeCode ?? 'Unknown product'}
        </h3>
        {row.coverTier && <span className="badge">{row.coverTier}</span>}
      </div>
      <dl className="field-dl">
        <div className="field-dl__row">
          <dt className="field-dl__label">Plan</dt>
          <dd className="field-dl__value">
            {row.planCode ?? '—'}
            {row.planName && row.planName !== row.planCode ? ` — ${row.planName}` : ''}
          </dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Benefit group</dt>
          <dd className="field-dl__value">{row.benefitGroupName ?? '—'}</dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Cover basis</dt>
          <dd className="field-dl__value">{row.coverBasis ?? '—'}</dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Premium rate</dt>
          <dd className="field-dl__value">{rateLabel()}</dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Effective from</dt>
          <dd className="field-dl__value">{formatDate(row.effectiveFrom)}</dd>
        </div>
      </dl>
    </div>
  );
}
