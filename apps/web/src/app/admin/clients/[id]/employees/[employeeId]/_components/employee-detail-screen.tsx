'use client';

import { ScreenShell } from '@/components/ui';
import { ACTION_LABEL, RELATION_LABEL } from '@/lib/dependent-labels';
import { employeeDisplayLabel } from '@/lib/employee-display';
import { formatDate } from '@/lib/format-date';
import { type RateShape, formatRate } from '@/lib/format-rate';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useState } from 'react';

type Tab = 'profile' | 'entitlements' | 'changeRequests';

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
  const crQ = trpc.employees.changeRequests.listByEmployee.useQuery({ employeeId });

  const employee = empQ.data;
  const data = (employee?.data ?? {}) as Record<string, unknown>;

  const pendingCrCount = crQ.data?.filter((r) => r.status === 'PENDING').length ?? 0;

  return (
    <ScreenShell
      title={employee ? employeeDisplayLabel(data) : 'Employee'}
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
        <button
          type="button"
          className={`tab-btn${tab === 'changeRequests' ? ' tab-btn--active' : ''}`}
          onClick={() => setTab('changeRequests')}
        >
          Change Requests
          {pendingCrCount > 0 && (
            <span className="badge ml-2">{pendingCrCount}</span>
          )}
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
      {tab === 'changeRequests' && (
        <ChangeRequestsTab
          employeeId={employeeId}
          loading={crQ.isLoading}
          {...(crQ.error ? { error: crQ.error.message } : {})}
          {...(crQ.data !== undefined ? { rows: crQ.data } : {})}
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
  rate: RateShape;
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
  if (!rows?.length) {
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
          <dd className="field-dl__value">{formatRate(row.rate)}</dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Effective from</dt>
          <dd className="field-dl__value">{formatDate(row.effectiveFrom)}</dd>
        </div>
      </dl>
    </div>
  );
}

type ChangeRequest = {
  id: string;
  action: string;
  relation: string;
  status: string;
  data: unknown;
  dependentId: string | null;
  rejectionReason: string | null;
  createdAt: Date | string;
};

function ChangeRequestsTab({
  employeeId,
  loading,
  error,
  rows,
}: {
  employeeId: string;
  loading: boolean;
  error?: string;
  rows?: ChangeRequest[];
}) {
  const utils = trpc.useUtils();
  const approveMutation = trpc.employees.changeRequests.approve.useMutation();
  const rejectMutation = trpc.employees.changeRequests.reject.useMutation();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (!rows?.length) {
    return (
      <div className="card card-padded">
        <p className="muted">No change requests for this employee.</p>
      </div>
    );
  }

  async function handleApprove(requestId: string) {
    setActionError(null);
    try {
      await approveMutation.mutateAsync({ requestId });
      await utils.employees.changeRequests.listByEmployee.invalidate({ employeeId });
      await utils.employees.entitlements.invalidate({ employeeId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve.');
    }
  }

  async function handleReject(requestId: string) {
    setActionError(null);
    try {
      await rejectMutation.mutateAsync({ requestId, reason: rejectReason || undefined });
      await utils.employees.changeRequests.listByEmployee.invalidate({ employeeId });
      setRejectingId(null);
      setRejectReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject.');
    }
  }

  const isBusy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="flex flex-col gap-3">
      {actionError && <p className="field-error">{actionError}</p>}
      {rows.map((req) => {
        const reqData = (req.data ?? {}) as Record<string, unknown>;
        const depName = String(reqData.full_name ?? '—');
        const isPending = req.status === 'PENDING';

        return (
          <div key={req.id} className="card card-padded">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {ACTION_LABEL[req.action] ?? req.action}{' '}
                  {RELATION_LABEL[req.relation] ?? req.relation}
                  {req.action !== 'REMOVE' && ` — ${depName}`}
                </p>
                <p className="text-xs muted mt-0.5">
                  Submitted {formatDate(req.createdAt)}
                </p>
                {req.rejectionReason && (
                  <p className="text-xs muted mt-0.5">Reason: {req.rejectionReason}</p>
                )}
              </div>
              <span
                className={`badge shrink-0 ${req.status === 'APPROVED' ? 'badge--success' : req.status === 'REJECTED' ? 'badge--danger' : ''}`}
              >
                {req.status}
              </span>
            </div>

            {isPending && rejectingId !== req.id && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleApprove(req.id)}
                  disabled={isBusy}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setRejectingId(req.id); setRejectReason(''); }}
                  disabled={isBusy}
                >
                  Reject
                </button>
              </div>
            )}

            {isPending && rejectingId === req.id && (
              <div className="flex flex-col gap-2 mt-3">
                <input
                  type="text"
                  className="input"
                  placeholder="Reason for rejection (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleReject(req.id)}
                    disabled={isBusy}
                  >
                    {isBusy ? 'Rejecting…' : 'Confirm rejection'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setRejectingId(null)}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
