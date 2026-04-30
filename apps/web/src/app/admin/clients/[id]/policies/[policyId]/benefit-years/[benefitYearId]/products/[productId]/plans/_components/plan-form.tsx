// =============================================================
// PlanForm — shared between new + edit plan pages.
//
// Layout:
//   1. Metadata (hand-rolled): code, name, coverBasis (from
//      planSchema's coverBasis enum), stacksOn (dropdown of other
//      plans on the product), selectionMode, effective dates.
//   2. Schedule (auto-generated): @rjsf/core form against
//      planSchema.properties.schedule.
//
// Server validates the full plan against planSchema via Ajv on save.
// =============================================================

'use client';

import { ScreenShell } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import Form from '@rjsf/core';
import type { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type SelectionMode = 'broker_default' | 'employee_flex';

type FormState = {
  code: string;
  name: string;
  coverBasis: string;
  stacksOn: string;
  selectionMode: SelectionMode;
  effectiveFrom: string;
  effectiveTo: string;
  schedule: Record<string, unknown>;
};

const emptyForm = (defaultCoverBasis: string): FormState => ({
  code: '',
  name: '',
  coverBasis: defaultCoverBasis,
  stacksOn: '',
  selectionMode: 'broker_default',
  effectiveFrom: '',
  effectiveTo: '',
  schedule: {},
});

// Extracts the allowed coverBasis values from the planSchema. The
// catalogue seed narrows this per product type; the predicate
// shape is `{ enum: [...] }` either at the property level or inside
// allOf branches. We only need the simple top-level enum case here.
function extractCoverBasisEnum(planSchema: unknown): string[] {
  const obj = planSchema as { properties?: { coverBasis?: { enum?: unknown[] } } };
  const list = obj.properties?.coverBasis?.enum;
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is string => typeof v === 'string');
}

// Pulls the schedule sub-schema for the @rjsf form below.
function extractScheduleSchema(planSchema: unknown): RJSFSchema | null {
  const obj = planSchema as { properties?: { schedule?: unknown } };
  const sched = obj.properties?.schedule;
  if (!sched || typeof sched !== 'object') return null;
  return sched as RJSFSchema;
}

export function PlanForm({
  clientId,
  policyId,
  benefitYearId,
  productId,
  planId,
  mode,
}: {
  clientId: string;
  policyId: string;
  benefitYearId: string;
  productId: string;
  planId?: string;
  mode: 'create' | 'edit';
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  // Always need the product (for planSchema, plan list, editable state).
  const product = trpc.products.byId.useQuery({ id: productId });
  const sibling = trpc.plans.listByProduct.useQuery({ productId });
  // Edit mode only.
  const plan = trpc.plans.byId.useQuery(
    { id: planId ?? '' },
    { enabled: mode === 'edit' && Boolean(planId) },
  );

  const create = trpc.plans.create.useMutation({
    onSuccess: async () => {
      await utils.plans.listByProduct.invalidate({ productId });
      router.push(
        `/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${productId}/edit`,
      );
    },
    onError: (err) => setFormError(err.message),
  });
  const update = trpc.plans.update.useMutation({
    onSuccess: async () => {
      await utils.plans.listByProduct.invalidate({ productId });
      if (planId) await utils.plans.byId.invalidate({ id: planId });
      router.push(
        `/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${productId}/edit`,
      );
    },
    onError: (err) => setFormError(err.message),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // coverBasis enum lives on planSchema.properties.coverBasis per the
  // S16 seeded schemas. ProductType.schema is the product-level shape
  // and doesn't carry coverBasis at all.
  const coverBasisOptions = useMemo(
    () =>
      product.data ? extractCoverBasisEnum(product.data.productType.planSchema as unknown) : [],
    [product.data],
  );

  const scheduleSchema = useMemo<RJSFSchema | null>(
    () =>
      product.data ? extractScheduleSchema(product.data.productType.planSchema as unknown) : null,
    [product.data],
  );

  // Initialise form once data is loaded.
  useEffect(() => {
    if (form !== null) return;
    if (mode === 'create' && product.data) {
      setForm(emptyForm(coverBasisOptions[0] ?? ''));
      return;
    }
    if (mode === 'edit' && plan.data && product.data) {
      setForm({
        code: plan.data.code,
        name: plan.data.name,
        coverBasis: plan.data.coverBasis,
        stacksOn: plan.data.stacksOn ?? '',
        selectionMode: plan.data.selectionMode as SelectionMode,
        effectiveFrom: plan.data.effectiveFrom
          ? new Date(plan.data.effectiveFrom).toISOString().slice(0, 10)
          : '',
        effectiveTo: plan.data.effectiveTo
          ? new Date(plan.data.effectiveTo).toISOString().slice(0, 10)
          : '',
        schedule: (plan.data.schedule as Record<string, unknown>) ?? {},
      });
    }
  }, [form, mode, product.data, plan.data, coverBasisOptions]);

  if (product.isLoading || (mode === 'edit' && plan.isLoading) || form === null)
    return <p>Loading…</p>;
  if (product.error)
    return <p className="field-error">Failed to load product: {product.error.message}</p>;
  if (plan.error) return <p className="field-error">Failed to load plan: {plan.error.message}</p>;
  if (!product.data) return null;

  const editable = product.data.benefitYear.state === 'DRAFT';
  // Pool of candidate base plans for stacksOn — exclude self when editing.
  const stackableSiblings = (sibling.data ?? []).filter((p) => p.id !== planId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      coverBasis: form.coverBasis,
      stacksOn: form.stacksOn || null,
      selectionMode: form.selectionMode,
      effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom) : null,
      effectiveTo: form.effectiveTo ? new Date(form.effectiveTo) : null,
      schedule: form.schedule,
    };
    if (mode === 'create') {
      create.mutate({ productId, ...payload });
    } else if (planId) {
      update.mutate({ id: planId, ...payload });
    }
  };

  const productHref = `/admin/clients/${clientId}/policies/${policyId}/benefit-years/${benefitYearId}/products/${productId}/edit`;

  return (
    <ScreenShell
      title={mode === 'create' ? 'New plan' : `Edit ${form.code}`}
      context={`${product.data.productType.code} plans`}
    >
      <section className="section">
        <div className="card card-padded">
          <form onSubmit={submit} className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="plan-code">
                Code
              </label>
              <input
                id="plan-code"
                className="input"
                type="text"
                required
                maxLength={40}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="P1"
                pattern="^P[A-Z0-9]+$"
                disabled={!editable}
              />
              <span className="field-help">Starts with P; uppercase + digits.</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-name">
                Name
              </label>
              <input
                id="plan-name"
                className="input"
                type="text"
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={!editable}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-cover">
                Cover basis
              </label>
              <select
                id="plan-cover"
                className="input"
                required
                value={form.coverBasis}
                onChange={(e) => setForm({ ...form, coverBasis: e.target.value })}
                disabled={!editable}
              >
                {coverBasisOptions.length === 0 ? (
                  <option value="">— No options in schema —</option>
                ) : null}
                {coverBasisOptions.map((cb) => (
                  <option key={cb} value={cb}>
                    {cb}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-stacks">
                Stacks on <span className="field-help-inline">(optional)</span>
              </label>
              <select
                id="plan-stacks"
                className="input"
                value={form.stacksOn}
                onChange={(e) => setForm({ ...form, stacksOn: e.target.value })}
                disabled={!editable || stackableSiblings.length === 0}
              >
                <option value="">— None —</option>
                {stackableSiblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
              <span className="field-help">
                Riders (e.g. STM Plan C/D over Plan B) layer on top of a base plan.
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-mode">
                Selection mode
              </label>
              <select
                id="plan-mode"
                className="input"
                value={form.selectionMode}
                onChange={(e) =>
                  setForm({ ...form, selectionMode: e.target.value as SelectionMode })
                }
                disabled={!editable}
              >
                <option value="broker_default">Broker default — assigned by eligibility</option>
                <option value="employee_flex">
                  Employee flex — employee picks (e.g. STM Flex)
                </option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-from">
                Effective from <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="plan-from"
                className="input"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                disabled={!editable}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="plan-to">
                Effective to <span className="field-help-inline">(optional)</span>
              </label>
              <input
                id="plan-to"
                className="input"
                type="date"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
                disabled={!editable}
              />
            </div>

            <fieldset className="fieldset field-span-full">
              <legend>Benefit schedule</legend>
              <p className="field-help mb-3">
                Fields below are generated from the {product.data.productType.code} plan schema. Any
                keyword (description, default, min/max) defined in the catalogue is rendered
                automatically.
              </p>
              {scheduleSchema ? (
                <Form
                  schema={scheduleSchema}
                  formData={form.schedule}
                  validator={validator}
                  disabled={!editable}
                  uiSchema={{ 'ui:submitButtonOptions': { norender: true } }}
                  onChange={({ formData }) =>
                    setForm({ ...form, schedule: (formData ?? {}) as Record<string, unknown> })
                  }
                  onSubmit={() => {
                    /* swallow — we use our own submit below */
                  }}
                  showErrorList="bottom"
                />
              ) : (
                <p className="field-help">No schedule fields defined in the plan schema.</p>
              )}
            </fieldset>

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              {editable ? (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={create.isPending || update.isPending}
                >
                  {create.isPending || update.isPending
                    ? 'Saving…'
                    : mode === 'create'
                      ? 'Add plan'
                      : 'Save changes'}
                </button>
              ) : null}
              <Link href={productHref} className="btn btn-ghost">
                {editable ? 'Cancel' : 'Back'}
              </Link>
            </div>
          </form>
        </div>
      </section>
    </ScreenShell>
  );
}
