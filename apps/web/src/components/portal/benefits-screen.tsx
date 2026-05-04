'use client';

import { trpc } from '@/lib/trpc/client';
import { BenefitCard } from './benefit-card';

export function BenefitsScreen() {
  const { data, isLoading, error } = trpc.portal.benefits.list.useQuery();

  if (isLoading) return <p className="muted">Loading your benefits…</p>;
  if (error) return <p className="field-error">{error.message}</p>;
  if (!data?.length) {
    return (
      <div className="card card-padded">
        <p className="muted">No active benefit enrollments found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((row) => (
        <BenefitCard key={row.enrollmentId} row={row} />
      ))}
    </div>
  );
}
