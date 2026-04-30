// =============================================================
// ReviewSection — apply gate. Shows a summary of what will be
// written, blocks until all required sections are complete, and
// fires extractionDrafts.applyToCatalogue on click.
//
// Apply is the single transactional commit: Client + Policy +
// PolicyEntities + BenefitYear in one $transaction. Per-product
// rows (Plans / PremiumRates / BenefitGroups / ProductEligibility)
// are written by the existing per-section apply pipelines once
// those sections ship.
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/server/trpc/router';
import type { inferRouterOutputs } from '@trpc/server';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DraftFormState, SectionId } from './_registry';

type SectionStatus = Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'>;

type Props = {
  form: DraftFormState;
  draft: inferRouterOutputs<AppRouter>['extractionDrafts']['byUploadId'];
  sectionStatus: SectionStatus;
  applyReadiness: number;
};

const REQUIRED_FOR_APPLY: SectionId[] = ['client', 'entities', 'benefit_year'];

export function ReviewSection({ form, draft, sectionStatus, applyReadiness }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [appliedClientId, setAppliedClientId] = useState<string | null>(null);

  const apply = trpc.extractionDrafts.applyToCatalogue.useMutation({
    onSuccess: (result) => {
      setAppliedClientId(result.clientId);
      // Give the user a beat to read the success state, then route
      // to the new client's policies surface.
      setTimeout(() => {
        router.push(`/admin/clients/${result.clientId}/policies`);
      }, 1200);
    },
    onError: (err) => setError(err.message),
  });

  const blockers = REQUIRED_FOR_APPLY.filter((id) => sectionStatus[id] !== 'complete');
  const canApply = blockers.length === 0 && draft.status !== 'APPLIED';

  const handleApply = () => {
    setError(null);
    apply.mutate({
      draftId: draft.id,
      existingClientId: null,
      proposed: {
        client: {
          legalName: form.client.legalName.trim(),
          tradingName: form.client.tradingName.trim() || null,
          uen: form.client.uen.trim(),
          countryOfIncorporation: form.client.countryOfIncorporation,
          address: form.client.address.trim(),
          industry: form.client.industry || null,
          primaryContactName: form.client.primaryContactName.trim() || null,
          primaryContactEmail: form.client.primaryContactEmail.trim() || null,
        },
        policy: {
          name: form.policy.name.trim(),
          ageBasis: form.policy.ageBasis,
        },
        policyEntities: form.policyEntities.map((e) => ({
          legalName: e.legalName.trim(),
          policyNumber: e.policyNumber.trim(),
          address: e.address.trim() || null,
          headcountEstimate: e.headcountEstimate,
          isMaster: e.isMaster,
        })),
        benefitYear: {
          startDate: new Date(form.benefitYear.startDate),
          endDate: new Date(form.benefitYear.endDate),
          ageBasis: form.policy.ageBasis,
          carryForwardFromYearId: form.benefitYear.carryForwardFromYearId,
        },
      },
    });
  };

  return (
    <>
      <h2>Review &amp; apply</h2>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">What this will create</h3>
          <ul className="kv-list">
            <li>
              <strong>1</strong> Client <em>{form.client.legalName || '—'}</em>
            </li>
            <li>
              <strong>{form.policyEntities.length}</strong> policy{' '}
              {form.policyEntities.length === 1 ? 'entity' : 'entities'}
            </li>
            <li>
              <strong>1</strong> Policy <em>{form.policy.name || '—'}</em>
            </li>
            <li>
              <strong>1</strong> Benefit year{' '}
              <em>
                {form.benefitYear.startDate || '?'} → {form.benefitYear.endDate || '?'}
              </em>
            </li>
          </ul>
          <p className="field-help">
            Per-product rows (Plans, Premium rates, Benefit groups, Eligibility) are written from
            the Products / Eligibility sections once those land in the next slice.
          </p>
        </Card>
      </section>

      <section className="section">
        <Card className="card-padded">
          <h3 className="mb-3">Apply readiness — {applyReadiness}%</h3>
          {blockers.length === 0 ? (
            <p className="text-good">✓ All required sections complete.</p>
          ) : (
            <>
              <p className="field-help">Resolve the blockers below before Apply enables.</p>
              <ul className="issue-list">
                {blockers.map((id) => (
                  <li key={id} className="issue is-warning">
                    <strong>{id}</strong> — section status: {sectionStatus[id]}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error ? <p className="field-error mt-3">{error}</p> : null}
          {appliedClientId ? (
            <p className="text-good mt-3">✓ Applied. Redirecting to the new client&hellip;</p>
          ) : null}

          <div className="row mt-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canApply || apply.isPending}
              onClick={handleApply}
            >
              {apply.isPending ? 'Applying…' : 'Apply everything'}
            </button>
          </div>
        </Card>
      </section>
    </>
  );
}
