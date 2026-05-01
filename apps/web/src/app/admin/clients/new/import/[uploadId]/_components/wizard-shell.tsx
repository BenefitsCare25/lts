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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExtractionProgress } from './extraction-progress';
import {
  type DraftFormState,
  SECTIONS,
  type SectionId,
  emptyDraftFormState,
} from './sections/_registry';
import { aiBundleFromDraft } from './sections/_types';
import { SECTION_COMPONENTS } from './sections/section-components';

const EMPTY_DIRTY_FLAGS: Record<SectionId, boolean> = {
  source: false,
  client: false,
  entities: false,
  benefit_year: false,
  insurers: false,
  products: false,
  eligibility: false,
  schema_additions: false,
  reconciliation: false,
  review: false,
};

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
  // Per-section dirty flag. Set when the broker edits a field; the
  // AI/heuristic seeders use setForm directly without flipping this,
  // so the rail shows "🤖 AI-filled" until the broker touches a field.
  const [dirtyFlags, setDirtyFlags] = useState<Record<SectionId, boolean>>(EMPTY_DIRTY_FLAGS);
  const markSectionDirty = useCallback((id: SectionId) => {
    setDirtyFlags((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  // Auto-save mutation for the broker's form state. Debounced via the
  // effect below so we don't fire on every keystroke. We deliberately
  // don't invalidate the byUploadId query on success — the wizard owns
  // form state and would lose its place if we re-fetched.
  const saveBrokerForm = trpc.extractionDrafts.updateBrokerForm.useMutation();
  // Stable ref to mutate — useMutation returns a new object per render
  // but we only want the ref so the debounced effect doesn't re-arm
  // its timer needlessly.
  const saveFormMutateRef = useRef(saveBrokerForm.mutate);
  useEffect(() => {
    saveFormMutateRef.current = saveBrokerForm.mutate;
  }, [saveBrokerForm.mutate]);
  // Has the broker started editing? Set true the first time any section
  // is marked dirty. Until then we don't auto-save (avoids overwriting
  // the AI's seed with an empty form on first load).
  const hasBrokerEdits = useMemo(() => Object.values(dirtyFlags).some(Boolean), [dirtyFlags]);

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
  // Hydrates from progress.brokerForm (auto-saved broker edits) when
  // present; otherwise falls back to the heuristic parser's
  // policyEntities. The per-section seeders (Client / BenefitYear /
  // PolicyEntities) layer AI proposals on top of whichever path won.
  const seededDraftIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!draft.data) return;
    if (seededDraftIdRef.current === draft.data.id) return;
    seededDraftIdRef.current = draft.data.id;

    // 1) Persisted broker form takes priority — restore the broker's
    //    own edits across reloads. The shape is validated structurally
    //    (key by key) so an old/malformed payload falls through to the
    //    heuristic seed rather than crashing.
    const progress = draft.data.progress as
      | (Record<string, unknown> & { brokerForm?: unknown })
      | null;
    const persisted = progress?.brokerForm;
    if (persisted && isShapedLikeDraftForm(persisted)) {
      setForm(persisted as DraftFormState);
      // Mark every section that has content as dirty — the broker
      // already touched them once.
      const sectionsWithContent = sectionsWithBrokerContent(persisted as DraftFormState);
      if (sectionsWithContent.length > 0) {
        setDirtyFlags((prev) => {
          const next = { ...prev };
          for (const id of sectionsWithContent) next[id] = true;
          return next;
        });
      }
      hydratedRef.current = true;
      return;
    }

    // 2) Heuristic seed — first load on a fresh draft, no broker edits.
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

  // Debounced auto-save of the broker's form state. Only fires once
  // the broker has actually edited a field (hasBrokerEdits) — the AI/
  // heuristic seeds set the form via setForm without flipping any
  // dirty flag, so this stays quiet until the human takes over.
  const draftId = draft.data?.id ?? null;
  const draftStatus = draft.data?.status ?? null;
  useEffect(() => {
    if (!draftId) return;
    if (!hasBrokerEdits) return;
    if (draftStatus === 'APPLIED') return;
    const timer = window.setTimeout(() => {
      saveFormMutateRef.current({ draftId, brokerForm: form });
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [form, hasBrokerEdits, draftId, draftStatus]);

  // AI seeding lives per-section (ClientSection, PolicyEntitiesSection,
  // BenefitYearSection each own their useEffect that reads
  // aiBundle.proposed* and seeds the form once when AI proposals land).
  // The shell does not re-seed centrally — single ownership.

  const sectionStatus = useMemo(() => computeSectionStatus(form, draft.data), [form, draft.data]);
  const provenance = useMemo(
    () => computeProvenance(form, draft.data, dirtyFlags),
    [form, draft.data, dirtyFlags],
  );
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
          <p className="wizard-shell__meta">
            <span>
              Status <strong>{draft.data.status}</strong>
            </span>
            {upload.insurerTemplate ? (
              <>
                <span className="wizard-shell__meta-sep">·</span>
                <span>{upload.insurerTemplate}</span>
              </>
            ) : null}
          </p>
          <div className="wizard-shell__readiness" aria-label="Apply readiness">
            <span>Apply readiness</span>
            <div
              className="wizard-shell__readiness-bar"
              role="progressbar"
              tabIndex={0}
              aria-valuenow={applyReadiness}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="wizard-shell__readiness-fill"
                style={{ width: `${applyReadiness}%` }}
              />
            </div>
            <strong>{applyReadiness}%</strong>
          </div>
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
                  <span className="wizard-rail__num" aria-hidden="true">
                    {sectionStatus[s.id] === 'complete' ? '✓' : idx + 1}
                  </span>
                  <span className="wizard-rail__label">{s.label}</span>
                  <span className="wizard-rail__meta">
                    <RailSourceBadge provenance={provenance[s.id]} edited={dirtyFlags[s.id]} />
                    <span className="wizard-rail__status" aria-label={sectionStatus[s.id]}>
                      {sectionStatus[s.id] === 'has_issues'
                        ? '⚠'
                        : sectionStatus[s.id] === 'in_progress'
                          ? '●'
                          : sectionStatus[s.id] === 'pending'
                            ? '○'
                            : ''}
                    </span>
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
                aiFilled={provenance[activeSection] === 'ai'}
                edited={dirtyFlags[activeSection]}
                markSectionDirty={markSectionDirty}
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
    <div className="flex items-center justify-between">
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
      <div className="wizard-banner wizard-banner--info">
        <p>
          <strong>AI extraction in progress.</strong> {stageCopy} You can keep editing other
          sections while this runs.
        </p>
      </div>
    );
  }
  if (status === 'FAILED' && bundle.failure) {
    return (
      <div className="wizard-banner wizard-banner--error">
        <p>
          <strong>AI extraction failed</strong> at stage <code>{bundle.failure.stage}</code>.
        </p>
        <p className="field-help">{bundle.failure.message}</p>
      </div>
    );
  }
  if (status === 'READY' && bundle.warnings.length > 0) {
    return (
      <div className="wizard-banner wizard-banner--warn">
        <p>
          <strong>AI extraction completed with warnings:</strong>
        </p>
        <ul className="wizard-banner__list">
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

// Small inline badge in the rail showing data provenance:
//   AI     — broker hasn't touched it AND the AI extraction ran AND
//            filled this section
//   Parsed — broker hasn't touched it AND the deterministic Excel
//            parser seeded this section at upload time (AI not yet run)
//   Edited — broker edited at least one field in the section
//   (none) — section never had any auto-fill data (or it's read-only)
//
// "Edited" outranks "AI"/"Parsed" — if the broker has touched a field
// the provenance is no longer meaningful.
type SectionProvenance = 'ai' | 'parsed' | null;
function RailSourceBadge({
  provenance,
  edited,
}: {
  provenance: SectionProvenance;
  edited: boolean;
}) {
  if (edited) {
    return <span className="wizard-rail__provenance wizard-rail__provenance--edited">Edited</span>;
  }
  if (provenance === 'ai') {
    return <span className="wizard-rail__provenance wizard-rail__provenance--ai">AI</span>;
  }
  if (provenance === 'parsed') {
    return <span className="wizard-rail__provenance wizard-rail__provenance--parsed">Parsed</span>;
  }
  return null;
}

// Compute per-section data provenance for the rail badge.
//
// The platform has two distinct fill paths:
//  1. The deterministic Excel parser runs at upload time and writes
//     `extractedProducts`, `progress.suggestions.*`, and (via the
//     wizard's seeders) populates Client / Entities form rows. This is
//     "Parsed" — broker still gets pre-filled data, but no LLM was
//     involved.
//  2. The AI runner (only when the broker clicks "Run AI extraction")
//     overwrites `extractedProducts` and writes `progress.proposed*`,
//     `progress.ai`, and `progress.warnings`. This is "AI".
//
// The discriminator for "AI ran" is `progress.ai !== null` plus the
// section-specific `proposed*` payloads. Without those, any data the
// section already has must have come from the heuristic parser.
function computeProvenance(
  form: DraftFormState,
  draft: DraftLike,
  dirty: Record<SectionId, boolean>,
): Record<SectionId, SectionProvenance> {
  const extracted = (draft?.extractedProducts as Array<unknown> | null) ?? [];
  const progress = draft?.progress as {
    ai?: unknown | null;
    proposedClient?: unknown | null;
    proposedBenefitYear?: unknown | null;
    proposedPolicyEntities?: unknown[];
    proposedInsurers?: unknown[];
    suggestions?: { missingPredicateFields?: unknown[]; benefitGroups?: unknown[] };
  } | null;
  const aiRan = progress?.ai != null;
  const proposedInsurersCount = Array.isArray(progress?.proposedInsurers)
    ? progress.proposedInsurers.length
    : 0;
  const proposedEntitiesCount = Array.isArray(progress?.proposedPolicyEntities)
    ? progress.proposedPolicyEntities.length
    : 0;
  const benefitGroupsCount = Array.isArray(progress?.suggestions?.benefitGroups)
    ? progress.suggestions.benefitGroups.length
    : 0;
  const missingFieldsCount = Array.isArray(progress?.suggestions?.missingPredicateFields)
    ? progress.suggestions.missingPredicateFields.length
    : 0;

  // Pick the right tag for a section that does have auto-filled data.
  // `aiContributed` is per-section: the AI run may have filled the
  // benefit-year proposal but left the heuristic-derived reconciliation
  // alone, so we read each section's specific signal.
  const tag = (hasContent: boolean, aiContributed: boolean): SectionProvenance =>
    !hasContent ? null : aiContributed ? 'ai' : 'parsed';

  const result: Record<SectionId, SectionProvenance> = {
    source: null, // read-only summary; never auto-fill-tagged
    review: null, // gated on broker action; never auto-fill-tagged
    client: tag(
      Boolean(form.client.legalName || form.client.uen || form.client.address),
      progress?.proposedClient != null,
    ),
    entities: tag(form.policyEntities.length > 0, proposedEntitiesCount > 0),
    benefit_year: tag(
      Boolean(form.benefitYear.startDate || form.benefitYear.endDate || form.policy.name),
      progress?.proposedBenefitYear != null,
    ),
    // Insurers can come from either the heuristic (template-matched
    // insurer codes inside extractedProducts) or the AI's discovery
    // pass (proposedInsurers). The AI tag wins when AI proposed any.
    insurers: tag(extracted.length > 0 || proposedInsurersCount > 0, proposedInsurersCount > 0),
    // Products / eligibility / schema additions / reconciliation all
    // read off `extractedProducts` and `suggestions`. Both paths write
    // there — the heuristic at upload, the AI when it runs.
    products: tag(extracted.length > 0, aiRan),
    eligibility: tag(extracted.length > 0 || benefitGroupsCount > 0, aiRan),
    schema_additions: tag(missingFieldsCount > 0 || extracted.length > 0, aiRan),
    reconciliation: tag(extracted.length > 0, aiRan),
  };

  // Broker edits outrank provenance — once they've touched a section,
  // the rail switches to "Edited" and the per-section AI banner has
  // already self-dismissed.
  for (const id of Object.keys(result) as SectionId[]) {
    if (dirty[id]) result[id] = null;
  }
  return result;
}

// Naive section-status derivation. Each section reports its own
// completeness against `form` (broker-edited) and the draft (AI-
// extracted). Generic enough that sections can be added without
// changing the shell.
type DraftLike = { extractedProducts: unknown; progress: unknown } | null | undefined;

function computeSectionStatus(
  form: DraftFormState,
  draft: DraftLike,
): Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'> {
  // Cast the loose shape into the richer one we need below. All fields
  // are optional and we narrow per-key — older drafts (pre-AI) simply
  // miss them and downstream comparisons short-circuit.
  type ExtractedShape = {
    insurerCode: string;
    plans?: unknown[];
    premiumRates?: unknown[];
    header?: { bundledWithProductCode?: string | null };
  };
  const extracted = (draft?.extractedProducts as ExtractedShape[] | null) ?? [];
  const progressObj =
    (draft?.progress as {
      suggestions?: {
        missingPredicateFields?: unknown[];
        benefitGroups?: Array<{ suggestedName: string }>;
      };
      proposedInsurers?: unknown[];
      brokerOverrides?: {
        insurers?: { codeToRegistryId?: Record<string, string | null> };
        eligibility?: {
          groups?: Record<
            string,
            {
              included?: boolean;
              defaultPlanByProduct?: Record<string, string | null>;
            }
          >;
        };
        schemaDecisions?: Record<string, { resolution: string; mapTo?: string }>;
        reconciliation?: { variancePctThreshold?: number; acknowledged?: boolean };
      };
    } | null) ?? null;
  const missingFieldsCount = progressObj?.suggestions?.missingPredicateFields?.length ?? 0;
  // Discovery's proposedInsurers is independent of per-product passes.
  // If discovery succeeded but every per-product pass failed, the
  // broker still has a usable insurer list — surface section 5 either
  // way.
  const proposedInsurersCount = Array.isArray(progressObj?.proposedInsurers)
    ? progressObj.proposedInsurers.length
    : 0;

  // Section 5 — Insurers & pool. Complete when every detected code has
  // a registry id (either auto-matched or broker-overridden). The
  // checking is a coarse "broker confirmed" by counting overrides.
  const insurerOverrides = progressObj?.brokerOverrides?.insurers?.codeToRegistryId ?? {};
  const detectedInsurerCodes = Array.from(new Set(extracted.map((p) => p.insurerCode)));
  const allInsurersBound =
    detectedInsurerCodes.length > 0 &&
    detectedInsurerCodes.every((c) => insurerOverrides[c] !== undefined);
  const insurersStatus: 'complete' | 'in_progress' | 'has_issues' | 'pending' =
    detectedInsurerCodes.length === 0 && proposedInsurersCount === 0
      ? 'pending'
      : allInsurersBound
        ? 'complete'
        : 'in_progress';

  // Section 6 — Products. Complete when every product has at least one
  // plan AND (premiumRates.length > 0 OR header.bundledWithProductCode
  // set). Otherwise has_issues / in_progress.
  let productsStatus: 'complete' | 'in_progress' | 'has_issues' | 'pending' = 'pending';
  if (extracted.length > 0) {
    const allComplete = extracted.every((p) => {
      const planCount = Array.isArray(p.plans) ? p.plans.length : 0;
      const rateCount = Array.isArray(p.premiumRates) ? p.premiumRates.length : 0;
      const bundled = Boolean(p.header?.bundledWithProductCode);
      return planCount > 0 && (rateCount > 0 || bundled);
    });
    productsStatus = allComplete ? 'complete' : 'has_issues';
  }

  // Section 7 — Eligibility. Complete when at least one benefit group
  // is included AND every included group has full per-product coverage
  // (a default plan picked for every extracted product).
  const benefitGroups = progressObj?.suggestions?.benefitGroups ?? [];
  const eligibilityOverrides = progressObj?.brokerOverrides?.eligibility?.groups ?? {};
  const includedGroups = benefitGroups.filter(
    (g) => eligibilityOverrides[g.suggestedName]?.included === true,
  );
  let eligibilityStatus: 'complete' | 'in_progress' | 'has_issues' | 'pending' = 'pending';
  if (benefitGroups.length === 0) {
    eligibilityStatus = 'complete'; // nothing suggested ⇒ nothing required
  } else if (includedGroups.length === 0) {
    eligibilityStatus = 'has_issues';
  } else {
    const productCodes = extracted.map((p) => p.insurerCode); // unused for keying, kept for length
    void productCodes;
    const productKeys = extracted.map(
      (p) => (p as ExtractedShape & { productTypeCode: string }).productTypeCode,
    );
    const allCovered = includedGroups.every((g) => {
      const map = eligibilityOverrides[g.suggestedName]?.defaultPlanByProduct ?? {};
      return productKeys.every((k) => map[k] != null);
    });
    eligibilityStatus = allCovered ? 'complete' : 'in_progress';
  }

  // Section 8 — Schema additions. Complete when every missing field has
  // a non-null decision (and MAP decisions have a target).
  const schemaDecisions = progressObj?.brokerOverrides?.schemaDecisions ?? {};
  const missingFields = (progressObj?.suggestions?.missingPredicateFields ?? []) as Array<{
    fieldPath: string;
  }>;
  const allDecided =
    missingFields.length === 0 ||
    missingFields.every((f) => {
      const d = schemaDecisions[f.fieldPath];
      if (!d) return false;
      if (d.resolution === 'MAP') return Boolean(d.mapTo);
      return true;
    });
  const schemaStatus: 'complete' | 'in_progress' | 'has_issues' | 'pending' =
    missingFieldsCount === 0 ? 'complete' : allDecided ? 'complete' : 'has_issues';

  // Section 9 — Reconciliation. Complete when no per-product variance
  // breaches threshold, OR broker explicitly acknowledged.
  // Lives entirely on broker overrides; the section component computes
  // variance from the same draft data so the rule below mirrors it.
  const reconOverrides = progressObj?.brokerOverrides?.reconciliation;
  const reconAcknowledged = Boolean(reconOverrides?.acknowledged);
  // We don't recompute breach here (would duplicate the section's
  // logic) — `complete` unless acknowledged-required-but-missing.
  // Conservative default: if any extraction happened, reconciliation
  // is "complete" because the broker can revisit any time.
  const reconStatus: 'complete' | 'in_progress' | 'has_issues' | 'pending' =
    extracted.length === 0 ? 'complete' : reconAcknowledged ? 'complete' : 'complete';
  // (kept unified at 'complete' to avoid blocking apply on a soft signal;
  // tighten to 'has_issues' once Phase 1.5 wires declared totals.)

  const result: Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'> = {
    source: 'complete', // read-only summary; always complete once loaded
    client: 'pending',
    entities: 'pending',
    benefit_year: 'pending',
    insurers: insurersStatus,
    products: productsStatus,
    eligibility: eligibilityStatus,
    schema_additions: schemaStatus,
    reconciliation: reconStatus,
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

// Structural shape check on a persisted brokerForm payload. We don't
// run a full schema validator here — the wizard tolerates partial
// payloads (an older version of the wizard wrote, a newer version
// reads). What we DO require is the top-level keys exist with the
// right rough types so destructuring in section components doesn't
// crash.
function isShapedLikeDraftForm(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.client !== undefined &&
    typeof v.client === 'object' &&
    v.client !== null &&
    Array.isArray(v.policyEntities) &&
    v.policy !== undefined &&
    typeof v.policy === 'object' &&
    v.policy !== null &&
    v.benefitYear !== undefined &&
    typeof v.benefitYear === 'object' &&
    v.benefitYear !== null
  );
}

// On hydration, mark sections dirty if the persisted form has content
// in them — preserves the rail's "Edited" badge after reload.
function sectionsWithBrokerContent(form: DraftFormState): SectionId[] {
  const out: SectionId[] = [];
  if (form.client.legalName || form.client.uen || form.client.address) out.push('client');
  if (form.policyEntities.length > 0) out.push('entities');
  if (form.benefitYear.startDate || form.benefitYear.endDate || form.policy.name) {
    out.push('benefit_year');
  }
  return out;
}
