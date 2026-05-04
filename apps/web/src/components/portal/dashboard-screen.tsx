'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';

export function DashboardScreen() {
  const { data, isLoading } = trpc.portal.dashboard.useQuery();

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-padded flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Active Benefits</p>
          <p className="text-2xl font-bold mt-1">
            {isLoading ? '—' : (data?.enrollmentCount ?? 0)}
          </p>
        </div>
        <Link href="/portal/benefits" className="btn btn-secondary text-sm">
          View benefits
        </Link>
      </div>

      {(data?.pendingRequestCount ?? 0) > 0 && (
        <div className="card card-padded flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Pending Change Requests</p>
            <p className="text-2xl font-bold mt-1">{data?.pendingRequestCount}</p>
          </div>
          <Link href="/portal/dependents" className="btn btn-secondary text-sm">
            View dependents
          </Link>
        </div>
      )}
    </div>
  );
}
