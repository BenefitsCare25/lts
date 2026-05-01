// =============================================================
// ClientSection — editable Client form pre-seeded from the slip's
// header where the parser / extractor recovered values. Mirrors
// the manual-entry form so the broker doesn't see a different UX
// between modes.
// =============================================================

'use client';

import { Card, ConfidenceBadge } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/server/trpc/router';
import type { inferRouterOutputs } from '@trpc/server';
import { useEffect, useMemo, useRef } from 'react';
import type { DraftFormState, SectionId } from './_registry';
import { aiBundleFromDraft } from './_types';
import { AiFilledBanner } from './ai-filled-banner';

type Props = {
  form: DraftFormState;
  setForm: React.Dispatch<React.SetStateAction<DraftFormState>>;
  draft: inferRouterOutputs<AppRouter>['extractionDrafts']['byUploadId'];
  aiFilled: boolean;
  markSectionDirty: (id: SectionId) => void;
};

interface ParseResultLite {
  products?: {
    fields?: Record<string, unknown>;
  }[];
}

export function ClientSection({ form, setForm, draft, aiFilled, markSectionDirty }: Props) {
  const countries = trpc.referenceData.countries.useQuery();
  const industries = trpc.referenceData.industries.useQuery();

  const aiBundle = useMemo(() => aiBundleFromDraft(draft.progress), [draft.progress]);

  // Seed once per draft load. Priority: AI proposals (richer, higher
  // recall) → heuristic parser fallback. Only fills empty fields so
  // broker edits made before AI completes are preserved. The ref is
  // set only AFTER AI proposals are available so the seed runs once
  // the extraction finishes (the component remounts polling deps).
  const seededDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededDraftIdRef.current === draft.id) return;

    const proposed = aiBundle.proposedClient;
    const result = draft.upload.parseResult as ParseResultLite | null;
    const firstProductFields = result?.products?.[0]?.fields ?? {};
    const heuristicLegalName = String(firstProductFields.policyholder_name ?? '').trim();
    const heuristicAddress = String(firstProductFields.address ?? '').trim();

    // Skip if no source has any data yet (AI still running, parser empty).
    if (!proposed && !heuristicLegalName && !heuristicAddress) return;

    seededDraftIdRef.current = draft.id;
    setForm((prev) => ({
      ...prev,
      client: {
        legalName: prev.client.legalName || proposed?.legalName || heuristicLegalName || '',
        tradingName: prev.client.tradingName || proposed?.tradingName || '',
        uen: prev.client.uen || proposed?.uen || '',
        countryOfIncorporation:
          prev.client.countryOfIncorporation === 'SG' && proposed?.countryOfIncorporation
            ? proposed.countryOfIncorporation
            : prev.client.countryOfIncorporation,
        address: prev.client.address || proposed?.address || heuristicAddress || '',
        industry: prev.client.industry || proposed?.industry || '',
        primaryContactName: prev.client.primaryContactName || proposed?.primaryContactName || '',
        primaryContactEmail: prev.client.primaryContactEmail || proposed?.primaryContactEmail || '',
      },
    }));
  }, [draft.id, draft.upload.parseResult, aiBundle.proposedClient, setForm]);

  const country = useMemo(
    () => countries.data?.find((c) => c.code === form.client.countryOfIncorporation) ?? null,
    [countries.data, form.client.countryOfIncorporation],
  );
  const uenLooksValid = useMemo(() => {
    if (!form.client.uen) return null;
    if (!country?.uenPattern) return null;
    try {
      return new RegExp(country.uenPattern).test(form.client.uen);
    } catch {
      return null;
    }
  }, [form.client.uen, country?.uenPattern]);

  const update = <K extends keyof DraftFormState['client']>(
    key: K,
    value: DraftFormState['client'][K],
  ) => {
    markSectionDirty('client');
    setForm((prev) => ({ ...prev, client: { ...prev.client, [key]: value } }));
  };

  // Confidence comes from the AI proposal when available; falls back
  // to 0.7 ("medium") for heuristic-only seeds since the heuristic
  // parser doesn't track per-field confidence today.
  const seededLegalName = Boolean(form.client.legalName);
  const seededAddress = Boolean(form.client.address);
  const seedConfidence =
    typeof aiBundle.proposedClient?.confidence === 'number'
      ? aiBundle.proposedClient.confidence
      : 0.7;

  return (
    <>
      <h2>Client details</h2>
      <AiFilledBanner aiFilled={aiFilled} hint="From the AI's discovery pass." />

      <section className="section">
        <Card className="card-padded">
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="cli-legal">
                Legal entity name
                {seededLegalName ? (
                  <ConfidenceBadge confidence={seedConfidence} variant="dot" />
                ) : null}
              </label>
              <input
                id="cli-legal"
                className="input"
                type="text"
                required
                maxLength={200}
                value={form.client.legalName}
                onChange={(e) => update('legalName', e.target.value)}
              />
              {seededLegalName ? (
                <span className="field-help">Seeded from slip header.</span>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-trading">
                Trading name <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-trading"
                className="input"
                type="text"
                maxLength={200}
                value={form.client.tradingName}
                onChange={(e) => update('tradingName', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-country">
                Country of incorporation
              </label>
              <select
                id="cli-country"
                className="input"
                required
                value={form.client.countryOfIncorporation}
                onChange={(e) => update('countryOfIncorporation', e.target.value)}
                disabled={countries.isLoading}
              >
                {countries.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-uen">
                UEN
              </label>
              <input
                id="cli-uen"
                className="input"
                type="text"
                required
                maxLength={40}
                value={form.client.uen}
                onChange={(e) => update('uen', e.target.value.toUpperCase())}
                pattern={country?.uenPattern ?? undefined}
              />
              <span className="field-help">
                {country?.uenPattern
                  ? `Format for ${country.name}: ${country.uenPattern}`
                  : `No registration format on file for ${country?.name ?? 'this country'}.`}
                {uenLooksValid === false ? (
                  <>
                    {' '}
                    <strong className="text-error">Does not match expected format.</strong>
                  </>
                ) : null}
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-address">
                Registered address
                {seededAddress ? (
                  <ConfidenceBadge confidence={seedConfidence} variant="dot" />
                ) : null}
              </label>
              <textarea
                id="cli-address"
                className="input"
                required
                maxLength={500}
                rows={2}
                value={form.client.address}
                onChange={(e) => update('address', e.target.value)}
              />
              {seededAddress ? <span className="field-help">Seeded from slip header.</span> : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-industry">
                Industry (SSIC) <span className="field-help-inline">(optional)</span>
              </label>
              <select
                id="cli-industry"
                className="input"
                value={form.client.industry}
                onChange={(e) => update('industry', e.target.value)}
                disabled={industries.isLoading}
              >
                <option value="">— Select industry —</option>
                {industries.data?.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code} · {i.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-contact-name">
                Primary contact name <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-contact-name"
                className="input"
                type="text"
                maxLength={120}
                value={form.client.primaryContactName}
                onChange={(e) => update('primaryContactName', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="cli-contact-email">
                Contact email <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="cli-contact-email"
                className="input"
                type="email"
                maxLength={254}
                value={form.client.primaryContactEmail}
                onChange={(e) => update('primaryContactEmail', e.target.value)}
              />
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
