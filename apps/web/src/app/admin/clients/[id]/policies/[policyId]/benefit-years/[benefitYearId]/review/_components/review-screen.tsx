// =============================================================
// ReviewScreen — Screen 6 read-only summary + validation gate.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { formatDate } from '@/lib/format-date';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export function ReviewScreen({
  clientId,
  policyId,
  benefitYearId,
}: {
  clientId: string;
  policyId: string;
  benefitYearId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const summary = trpc.review.summary.useQuery({ benefitYearId });
  const validation = trpc.review.validate.useQuery({ benefitYearId });
  const publish = trpc.review.publish.useMutation({
    onSuccess: async () => {
      await utils.review.summary.invalidate({ benefitYearId });
      await utils.review.validate.invalidate({ benefitYearId });
      await utils.benefitYears.listByPolicy.invalidate({ policyId });
      router.push(`/admin/clients/${clientId}/policies/${policyId}/edit`);
    },
    onError: (err) => setPublishError(err.message),
  });

  const [acknowledged, setAcknowledged] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const productHref = (productId: string) =>
    `/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${productId}/edit`;

  // Group warnings by acknowledgement requirement.
  const warningCodes = useMemo(
    () => validation.data?.issues.filter((i) => i.severity === 'warning').map((i) => i.code) ?? [],
    [validation.data],
  );

  if (summary.isLoading || validation.isLoading) return <p>Loading…</p>;
  if (summary.error) return <p className="field-error">Failed to load: {summary.error.message}</p>;
  if (!summary.data || !validation.data) return null;

  const editable = summary.data.state === 'DRAFT';

  return (
    <ScreenShell
      title="Review & publish"
      context={
        <>
          {summary.data.policy.name} · {formatDate(summary.data.startDate)} →{' '}
          {formatDate(summary.data.endDate)} · <strong>{summary.data.state}</strong>
        </>
      }
    >
      <section className="section">
        <div className="card card-padded">
          <h3 className="mb-2">Validation</h3>
          {validation.data.issues.length === 0 ? (
            <p className="text-good">✓ Clean — 0 blockers, 0 warnings.</p>
          ) : (
            <>
              <p>
                {validation.data.blockers} blocker{validation.data.blockers === 1 ? '' : 's'} ·{' '}
                {validation.data.warnings} warning{validation.data.warnings === 1 ? '' : 's'}
              </p>
              <ul className="mt-2">
                {validation.data.issues.map((i, idx) => (
                  <li
                    key={`${i.code}-${idx}`}
                    style={{
                      color:
                        i.severity === 'blocker'
                          ? 'var(--color-error, #b91c1c)'
                          : 'var(--color-warn, #92400e)',
                      marginBottom: '4px',
                    }}
                  >
                    <strong>{i.severity.toUpperCase()}</strong>: {i.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Products ({summary.data.products.length})</h3>
        <div className="form-grid">
          {summary.data.products.map((p) => (
            <div key={p.id} className="card card-padded">
              <div
                className="row"
                style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}
              >
                <h4 className="m-0">
                  <code>{p.productType.code}</code> · {p.productType.name}
                </h4>
                <Link href={productHref(p.id)} className="btn btn-ghost btn-sm">
                  Edit
                </Link>
              </div>
              <dl className="dl">
                <dt>Insurer</dt>
                <dd>{p.insurer ? `${p.insurer.name} (${p.insurer.code})` : '—'}</dd>
                <dt>TPA</dt>
                <dd>{p.tpa ? `${p.tpa.name} (${p.tpa.code})` : '—'}</dd>
                <dt>Pool</dt>
                <dd>{p.pool?.name ?? '—'}</dd>
                <dt>Plans</dt>
                <dd>
                  {p.plans.length === 0
                    ? '—'
                    : p.plans.map((pl) => pl.code + (pl.stacksOn ? ' (rider)' : '')).join(', ')}
                </dd>
                <dt>Eligibility rows</dt>
                <dd>{p.eligibility.length}</dd>
                <dt>Premium rates</dt>
                <dd>{p.premiumRates.length}</dd>
                <dt>Strategy</dt>
                <dd>
                  <code>{p.productType.premiumStrategy}</code>
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="mb-3">Benefit groups ({summary.data.policy.benefitGroups.length})</h3>
        {summary.data.policy.benefitGroups.length === 0 ? (
          <p className="field-help">None defined.</p>
        ) : (
          <ul>
            {summary.data.policy.benefitGroups.map((g) => (
              <li key={g.id}>
                <strong>{g.name}</strong>
                {g.description ? ` — ${g.description}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h3 className="mb-3">Entities ({summary.data.policy.entities.length})</h3>
        {summary.data.policy.entities.length === 0 ? (
          <p className="field-error">No entities defined.</p>
        ) : (
          <ul>
            {summary.data.policy.entities.map((e) => (
              <li key={e.id}>
                {e.legalName} — policy <code>{e.policyNumber}</code>
                {e.isMaster ? ' · master' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable ? (
        <section className="section">
          <div className="card card-padded">
            <h3 className="mb-2">Publish</h3>
            <p className="field-help mb-3">
              Once published, this benefit year is locked. Plans, products, and entities can no
              longer be edited. To change the configuration after publish, archive the year and
              create a new draft.
            </p>

            {warningCodes.length > 0 ? (
              <label
                className="toggle"
                style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}
              >
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I acknowledge {warningCodes.length} warning
                  {warningCodes.length === 1 ? '' : 's'} and want to publish anyway.
                </span>
              </label>
            ) : null}

            {publishError ? <p className="field-error">{publishError}</p> : null}

            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !validation.data.canPublish ||
                  (warningCodes.length > 0 && !acknowledged) ||
                  publish.isPending
                }
                onClick={() => {
                  setPublishError(null);
                  publish.mutate({
                    benefitYearId,
                    expectedPolicyVersionId: summary.data.policy.versionId,
                    acknowledgedWarnings: warningCodes,
                  });
                }}
              >
                {publish.isPending ? 'Publishing…' : 'Publish benefit year'}
              </button>
              <Link
                href={`/admin/clients/${clientId}/policies/${policyId}/edit`}
                className="btn btn-ghost"
              >
                Back to policy
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="card card-padded">
            <p className="mb-0">
              <strong>Locked.</strong> This benefit year is {summary.data.state.toLowerCase()}.
              {summary.data.publishedAt
                ? ` Published on ${formatDate(summary.data.publishedAt)}.`
                : ''}
            </p>
          </div>
        </section>
      )}
    </ScreenShell>
  );
}
