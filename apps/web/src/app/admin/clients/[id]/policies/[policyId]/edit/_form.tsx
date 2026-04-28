// =============================================================
// Policy editor — name + repeating entity rows + rate-overrides
// JSON. The save path carries Policy.versionId to the server for
// optimistic-locking; a stale save returns CONFLICT and the user
// is told to refresh.
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BenefitYearsSection } from './_benefit-years';

// Local mirror of the entity shape we drive the form with. Keeps
// rateOverrides as a string while editing so the textarea can hold
// half-typed JSON without forcing parse on every keystroke.
type EntityRow = {
  id?: string;
  legalName: string;
  policyNumber: string;
  address: string;
  headcountEstimate: string; // text input; parsed on save
  isMaster: boolean;
  rateOverridesText: string; // empty string = null on save
};

type FormState = {
  name: string;
  entities: EntityRow[];
};

const emptyEntity = (): EntityRow => ({
  legalName: '',
  policyNumber: '',
  address: '',
  headcountEstimate: '',
  isMaster: false,
  rateOverridesText: '',
});

// Validates an entity's rateOverrides text and returns the parsed
// payload (or null), or a parse-error string. Empty text → null.
function parseRateOverrides(
  text: string,
): { value: Record<string, unknown> | null; error: null } | { value: null; error: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { value: null, error: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null) return { value: null, error: null };
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: 'Rate overrides must be a JSON object or null.' };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : 'Invalid JSON.' };
  }
}

export function EditPolicyForm({
  clientId,
  policyId,
}: {
  clientId: string;
  policyId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const policy = trpc.policies.byId.useQuery({ id: policyId });
  const update = trpc.policies.update.useMutation({
    onSuccess: async () => {
      await utils.policies.listByClient.invalidate({ clientId });
      await utils.policies.byId.invalidate({ id: policyId });
      router.push(`/admin/clients/${clientId}/policies`);
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!policy.data || form !== null) return;
    setForm({
      name: policy.data.name,
      entities: policy.data.entities.map((e) => ({
        id: e.id,
        legalName: e.legalName,
        policyNumber: e.policyNumber,
        address: e.address ?? '',
        headcountEstimate: e.headcountEstimate === null ? '' : String(e.headcountEstimate),
        isMaster: e.isMaster,
        rateOverridesText: e.rateOverrides === null ? '' : JSON.stringify(e.rateOverrides, null, 2),
      })),
    });
  }, [policy.data, form]);

  // Per-row JSON parse status — drives inline validation + submit gate.
  const rowParseStatus = useMemo(() => {
    if (form === null) return [];
    return form.entities.map((e) => parseRateOverrides(e.rateOverridesText));
  }, [form]);

  const anyJsonInvalid = rowParseStatus.some((r) => r.error !== null);

  // Indexed access on rowParseStatus is `T | undefined` under
  // noUncheckedIndexedAccess. In practice the array is the same
  // length as form.entities, so the fallback is unreachable —
  // we still provide one to satisfy the type narrower.
  const parseFallback = { value: null, error: null } as const;

  if (policy.error) return <p className="field-error">Failed to load: {policy.error.message}</p>;
  if (!policy.data || form === null) return <p>Loading…</p>;

  const updateEntity = (index: number, patch: Partial<EntityRow>) => {
    setForm((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        entities: prev.entities.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      };
    });
  };

  const setMaster = (index: number) => {
    setForm((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e, i) => ({ ...e, isMaster: i === index })),
      };
    });
  };

  const addEntity = () => {
    setForm((prev) =>
      prev === null ? prev : { ...prev, entities: [...prev.entities, emptyEntity()] },
    );
  };

  const removeEntity = (index: number) => {
    setForm((prev) =>
      prev === null ? prev : { ...prev, entities: prev.entities.filter((_, i) => i !== index) },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (anyJsonInvalid) {
      setFormError('Fix the rate-overrides JSON errors before saving.');
      return;
    }
    update.mutate({
      id: policyId,
      expectedVersionId: policy.data.versionId,
      data: {
        name: form.name.trim(),
        entities: form.entities.map((row, i) => {
          const parsed = rowParseStatus[i] ?? parseFallback;
          const headcount = row.headcountEstimate.trim();
          return {
            ...(row.id ? { id: row.id } : {}),
            legalName: row.legalName.trim(),
            policyNumber: row.policyNumber.trim(),
            address: row.address.trim() || null,
            headcountEstimate: headcount === '' ? null : Number.parseInt(headcount, 10),
            isMaster: row.isMaster,
            rateOverrides: parsed.value,
          };
        }),
      },
    });
  };

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href={`/admin/clients/${clientId}/policies`}>← Policies</Link>
          {policy.data?.client ? <> · {policy.data.client.legalName}</> : null}
        </p>
        <h1>Edit policy</h1>
        <p className="field-help">Saved version: v{policy.data.versionId}</p>
      </section>

      <section className="section">
        <div className="card card-padded">
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="pol-name">
                Policy name
              </label>
              <input
                id="pol-name"
                className="input"
                type="text"
                required
                maxLength={200}
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => (prev === null ? prev : { ...prev, name: e.target.value }))
                }
              />
            </div>

            <fieldset className="fieldset" style={{ gridColumn: '1 / -1' }}>
              <legend>Entities</legend>
              <p className="field-help" style={{ marginBottom: '0.75rem' }}>
                Each entity carries its own insurer-issued policy number and may override premium
                rates per product. Mark exactly one entity as the master policyholder.
              </p>

              {form.entities.length === 0 ? (
                <p className="field-help">No entities yet — add at least one row below.</p>
              ) : null}

              {form.entities.map((row, idx) => {
                const parse = rowParseStatus[idx] ?? parseFallback;
                return (
                  <div
                    key={row.id ?? `new-${idx}`}
                    className="card card-padded"
                    style={{ marginBottom: '0.75rem' }}
                  >
                    <div className="form-grid">
                      <div className="field">
                        <label className="field-label" htmlFor={`pe-name-${idx}`}>
                          Legal entity name
                        </label>
                        <input
                          id={`pe-name-${idx}`}
                          className="input"
                          type="text"
                          required
                          maxLength={200}
                          value={row.legalName}
                          onChange={(e) => updateEntity(idx, { legalName: e.target.value })}
                        />
                      </div>

                      <div className="field">
                        <label className="field-label" htmlFor={`pe-number-${idx}`}>
                          Policy number
                        </label>
                        <input
                          id={`pe-number-${idx}`}
                          className="input"
                          type="text"
                          required
                          maxLength={80}
                          value={row.policyNumber}
                          onChange={(e) => updateEntity(idx, { policyNumber: e.target.value })}
                          placeholder="GE/2026/00123"
                        />
                      </div>

                      <div className="field">
                        <label className="field-label" htmlFor={`pe-address-${idx}`}>
                          Address <span className="field-help-inline">(optional)</span>
                        </label>
                        <input
                          id={`pe-address-${idx}`}
                          className="input"
                          type="text"
                          maxLength={500}
                          value={row.address}
                          onChange={(e) => updateEntity(idx, { address: e.target.value })}
                        />
                      </div>

                      <div className="field">
                        <label className="field-label" htmlFor={`pe-hc-${idx}`}>
                          Headcount estimate <span className="field-help-inline">(optional)</span>
                        </label>
                        <input
                          id={`pe-hc-${idx}`}
                          className="input"
                          type="number"
                          min={0}
                          value={row.headcountEstimate}
                          onChange={(e) => updateEntity(idx, { headcountEstimate: e.target.value })}
                        />
                      </div>

                      <label className="toggle">
                        <input
                          type="radio"
                          name="master-entity"
                          checked={row.isMaster}
                          onChange={() => setMaster(idx)}
                        />
                        Master policyholder
                      </label>

                      <div className="field" style={{ gridColumn: '1 / -1' }}>
                        <label className="field-label" htmlFor={`pe-rate-${idx}`}>
                          Rate overrides (JSON){' '}
                          <span className="field-help-inline">
                            (optional — leave blank to inherit from product/plan)
                          </span>
                        </label>
                        <textarea
                          id={`pe-rate-${idx}`}
                          className="input"
                          rows={4}
                          value={row.rateOverridesText}
                          onChange={(e) => updateEntity(idx, { rateOverridesText: e.target.value })}
                          placeholder={'{\n  "GHS": { "rate_per_thousand": 1.85 }\n}'}
                          spellCheck={false}
                          style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                        />
                        {parse.error ? (
                          <span className="field-error">JSON: {parse.error}</span>
                        ) : (
                          <span className="field-help">
                            {row.rateOverridesText.trim() === ''
                              ? 'No overrides — entity inherits from product/plan.'
                              : 'Parses as object — saved as JSONB.'}
                          </span>
                        )}
                      </div>

                      <div className="row" style={{ gridColumn: '1 / -1' }}>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeEntity(idx)}
                        >
                          Remove entity
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="btn btn-ghost btn-sm" onClick={addEntity}>
                + Add entity
              </button>
            </fieldset>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={update.isPending || anyJsonInvalid}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <Link href={`/admin/clients/${clientId}/policies`} className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>

      <BenefitYearsSection clientId={clientId} policyId={policyId} />

      <section className="section">
        <h3 style={{ marginBottom: '0.75rem' }}>Benefit groups</h3>
        <p style={{ marginBottom: '1rem', maxWidth: '60ch' }}>
          Predicate-based cohorts (e.g. "Senior Management", "Foreign Workers WP/SP HJG 08-10") that
          drive the eligibility matrix on each product.
        </p>
        <Link
          href={`/admin/clients/${clientId}/policies/${policyId}/benefit-groups`}
          className="btn btn-primary"
        >
          Manage benefit groups →
        </Link>
      </section>
    </>
  );
}
