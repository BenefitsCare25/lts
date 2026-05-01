// =============================================================
// WizardShell — three-pane layout for the import-first wizard.
//
//   ┌──── header (file + apply readiness) ────┐
//   ├─────────┬───────────────────────┬────────┤
//   │ left    │       main form pane  │ right  │
//   │ rail    │                       │ source │
//   │ (sects) │                       │ rail   │
//   ├─────────┴───────────────────────┴────────┤
//   │ footer (prev / next / save draft)        │
//   └──────────────────────────────────────────┘
//
// The shell is generic — it doesn't know which sections exist.
// SECTIONS below is the registry; adding a new section = adding a
// row + a component. No per-section branching in the shell itself.
//
// State lives in URL hash (#section-id) so the broker can deep-link
// or reload mid-wizard and land on the same section.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExtractionProgress } from './extraction-progress';
import {
  type DraftFormState,
  SECTIONS,
  type SectionId,
  emptyDraftFormState,
} from './sections/_registry';
import { aiBundleFromDraft } from './sections/_types';
import { SECTION_COMPONENTS } from './sections/section-components';

type Props = { uploadId: string };

export function WizardShell({ uploadId }: Props) {
  // Refetch every 2s while the extraction worker is running so the
  // wizard's status pill, source-section AI panel, and downstream
  // section seeding all flip to the populated state without the
  // broker having to manually reload.
  const draft = trpc.extractionDrafts.byUploadId.useQuery(
    { uploadId },
    {
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.status === 'EXTRACTING' ? 2_000 : false;
      },
      refetchOnWindowFocus: false,
    },
  );

  const [activeSection, setActiveSection] = useState<SectionId>('source');
  const [form, setForm] = useState<DraftFormState>(() => emptyDraftFormState());

  // Keep activeSection in sync with the URL hash so reloads land on
  // the same section. Setting via UI updates both.
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '');
    const candidate = SECTIONS.find((s) => s.id === fromHash);
    if (candidate) setActiveSection(candidate.id);
  }, []);

  const goTo = (id: SectionId) => {
    setActiveSection(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  // Seed the form's source-derived fields exactly once per draft —
  // a useRef guard means a tRPC refetch (focus refocus, etc.) won't
  // re-seed and overwrite a broker who deliberately cleared an entity.
  const seededDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft.data) return;
    if (seededDraftIdRef.current === draft.data.id) return;
    seededDraftIdRef.current = draft.data.id;
    const parseResult =
      (draft.data.upload.parseResult as null | {
        policyEntities?: { policyNumber: string; legalName: string; isMaster: boolean }[];
      }) ?? null;
    const seedEntities = parseResult?.policyEntities;
    if (!seedEntities?.length) return;
    setForm((prev) => {
      if (prev.policyEntities.length > 0) return prev;
      return {
        ...prev,
        policyEntities: seedEntities.map((e, i) => ({
          legalName: e.legalName,
          policyNumber: e.policyNumber,
          address: '',
          headcountEstimate: null,
          isMaster: i === 0 ? true : e.isMaster,
        })),
      };
    });
  }, [draft.data]);

  // AI seeding lives per-section (ClientSection, PolicyEntitiesSection,
  // BenefitYearSection each own their useEffect that reads
  // aiBundle.proposed* and seeds the form once when AI proposals land).
  // The shell does not re-seed centrally — single ownership.

  const sectionStatus = useMemo(() => computeSectionStatus(form, draft.data), [form, draft.data]);
  const applyReadiness = useMemo(() => {
    const total = SECTIONS.length;
    const ready = SECTIONS.filter((s) => sectionStatus[s.id] === 'complete').length;
    return Math.round((ready / total) * 100);
  }, [sectionStatus]);

  if (draft.isLoading) {
    return (
      <main className="wizard-shell">
        <p>Loading extraction draft…</p>
      </main>
    );
  }
  if (draft.error) {
    return (
      <main className="wizard-shell">
        <p className="field-error">Failed to load draft: {draft.error.message}</p>
        <Link href="/admin/clients/new" className="btn btn-ghost">
          ← Back to new client
        </Link>
      </main>
    );
  }
  if (!draft.data) return null;
  const upload = draft.data.upload;
  const aiBundle = aiBundleFromDraft(draft.data.progress);
  const aiBanner = renderAiBanner(draft.data.status, aiBundle);

  return (
    <main className="wizard-shell">
      <header className="wizard-shell__head">
        <div>
          <h1>{upload.filename}</h1>
          <p className="field-help">
            Status <strong>{draft.data.status}</strong>
            {upload.insurerTemplate ? ` · ${upload.insurerTemplate}` : ''}
            {' · '}Apply readiness <strong>{applyReadiness}%</strong>
          </p>
        </div>
        <div className="row">
          <Link href="/admin/clients/new" className="btn btn-ghost btn-sm">
            ← Pick mode
          </Link>
        </div>
      </header>
      {aiBanner}

      <div className="wizard-shell__body">
        <nav className="wizard-shell__rail" aria-label="Wizard sections">
          <ol className="wizard-rail">
            {SECTIONS.map((s, idx) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={[
                    'wizard-rail__item',
                    activeSection === s.id ? 'is-active' : '',
                    `is-${sectionStatus[s.id]}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => goTo(s.id)}
                >
                  <span className="wizard-rail__num">{idx + 1}</span>
                  <span className="wizard-rail__label">{s.label}</span>
                  <span className="wizard-rail__status" aria-label={sectionStatus[s.id]}>
                    {sectionStatus[s.id] === 'complete'
                      ? '✓'
                      : sectionStatus[s.id] === 'has_issues'
                        ? '⚠'
                        : sectionStatus[s.id] === 'in_progress'
                          ? '●'
                          : '○'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="wizard-shell__main">
          {(() => {
            const Component = SECTION_COMPONENTS[activeSection];
            return (
              <Component
                draft={draft.data}
                form={form}
                setForm={setForm}
                sectionStatus={sectionStatus}
                applyReadiness={applyReadiness}
              />
            );
          })()}
        </section>
      </div>

      <footer className="wizard-shell__foot">
        <PrevNextNav active={activeSection} onChange={goTo} />
      </footer>
    </main>
  );
}

function PrevNextNav({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  const idx = SECTIONS.findIndex((s) => s.id === active);
  const prev = idx > 0 ? SECTIONS[idx - 1] : null;
  const next = idx >= 0 && idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div>
        {prev ? (
          <button type="button" className="btn btn-ghost" onClick={() => onChange(prev.id)}>
            ← {prev.label}
          </button>
        ) : null}
      </div>
      <div>
        {next ? (
          <button type="button" className="btn btn-primary" onClick={() => onChange(next.id)}>
            {next.label} →
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Banner under the header. Live updates while EXTRACTING (the shell
// polls byUploadId every 2s); collapses to a quiet success or
// dismissable error once the run completes.
function renderAiBanner(
  status: string,
  bundle: ReturnType<typeof aiBundleFromDraft>,
): React.ReactNode {
  if (status === 'EXTRACTING') {
    // Rich progress card — only when we have streamed events (the
    // runner has started and persisted progress.live). Falls back to
    // a simple banner during the brief queued/early-startup window
    // before any events arrive.
    if (bundle.live) {
      return <ExtractionProgress live={bundle.live} />;
    }
    const stage = bundle.stage ?? 'QUEUED';
    const stageCopy =
      stage === 'CALLING_AI'
        ? 'Calling the AI provider — this usually takes 30–90 seconds.'
        : stage === 'MERGING'
          ? 'Merging the AI output with the heuristic baseline…'
          : stage === 'QUEUED'
            ? 'Queued — waiting for a worker to pick this up.'
            : 'Starting AI extraction…';
    return (
      <div
        className="card card-padded"
        style={{ borderColor: 'var(--accent-soft)', background: 'var(--accent-tint)' }}
      >
        <p className="mb-0">
          <strong>AI extraction in progress.</strong> {stageCopy} You can keep editing other
          sections while this runs.
        </p>
      </div>
    );
  }
  if (status === 'FAILED' && bundle.failure) {
    return (
      <div className="card card-padded" style={{ borderColor: 'var(--color-error)' }}>
        <p className="mb-2">
          <strong>AI extraction failed</strong> at stage <code>{bundle.failure.stage}</code>.
        </p>
        <p className="field-help mb-0">{bundle.failure.message}</p>
      </div>
    );
  }
  if (status === 'READY' && bundle.warnings.length > 0) {
    return (
      <div className="card card-padded" style={{ borderColor: 'var(--color-warn)' }}>
        <p className="mb-2">
          <strong>AI extraction completed with warnings:</strong>
        </p>
        <ul className="kv-list mb-0">
          {bundle.warnings.slice(0, 6).map((w, i) => (
            <li key={`warn-${i}-${w.slice(0, 30)}`}>{w}</li>
          ))}
          {bundle.warnings.length > 6 ? (
            <li>
              <em>… and {bundle.warnings.length - 6} more.</em>
            </li>
          ) : null}
        </ul>
      </div>
    );
  }
  return null;
}

// Seed the form state from the AI extraction bundle. Pure function —
// the ref guard in the caller ensures it only runs once per draft.
//
// Rule: only fill empty form fields. If the broker has typed
// something, we never overwrite. This makes the AI run safe to
// re-trigger after manual edits without losing the broker's work.
// Per-section ownership: ClientSection, PolicyEntitiesSection, and
// BenefitYearSection each seed their own slice of the form from
// aiBundle.proposed* via their own useEffect. The shell no longer
// owns the seed logic.

// Naive section-status derivation. Each section reports its own
// completeness against `form` (broker-edited) and the draft (AI-
// extracted). Generic enough that sections can be added without
// changing the shell.
type DraftLike = { extractedProducts: unknown; progress: unknown } | null | undefined;

function computeSectionStatus(
  form: DraftFormState,
  draft: DraftLike,
): Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'> {
  const extracted = (draft?.extractedProducts as Array<{ insurerCode: string }> | null) ?? [];
  const progressObj =
    (draft?.progress as { suggestions?: { missingPredicateFields?: unknown[] } } | null) ?? null;
  const missingFieldsCount = progressObj?.suggestions?.missingPredicateFields?.length ?? 0;
  const result: Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'> = {
    source: 'complete', // read-only summary; always complete once loaded
    client: 'pending',
    entities: 'pending',
    benefit_year: 'pending',
    // Insurers / products / eligibility / reconciliation are read-mostly
    // for now — they're "complete" the moment the draft is READY because
    // the broker isn't required to touch them before Apply (apply uses
    // form state for the foundational rows; per-product apply is next slice).
    insurers: extracted.length > 0 ? 'complete' : 'pending',
    products: extracted.length > 0 ? 'complete' : 'pending',
    eligibility: 'complete',
    // Schema additions: complete only if there are no missing fields,
    // OR if every missing field has been resolved (resolution lives in
    // section-local state today; coarse "any missing → has_issues").
    schema_additions: missingFieldsCount === 0 ? 'complete' : 'has_issues',
    reconciliation: 'complete',
    review: 'pending',
  };

  // Client
  if (form.client.legalName && form.client.uen && form.client.address) {
    result.client = 'complete';
  } else if (form.client.legalName || form.client.uen || form.client.address) {
    result.client = 'in_progress';
  }

  // Policy entities
  if (
    form.policyEntities.length > 0 &&
    form.policyEntities.every((e) => e.legalName && e.policyNumber)
  ) {
    result.entities = form.policyEntities.some((e) => e.isMaster) ? 'complete' : 'has_issues';
  } else if (form.policyEntities.length > 0) {
    result.entities = 'in_progress';
  }

  // Benefit year
  if (form.benefitYear.startDate && form.benefitYear.endDate && form.policy.name) {
    result.benefit_year = 'complete';
  } else if (form.benefitYear.startDate || form.benefitYear.endDate || form.policy.name) {
    result.benefit_year = 'in_progress';
  }

  // Review only completes once the apply has run; the section itself
  // tracks that via its own state.
  if (
    result.client === 'complete' &&
    result.entities === 'complete' &&
    result.benefit_year === 'complete'
  ) {
    result.review = 'complete';
  }

  return result;
}
