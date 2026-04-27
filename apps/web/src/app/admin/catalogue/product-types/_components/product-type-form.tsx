// =============================================================
// Shared form for create + edit. Either pass an existing product
// type via `initial` (edit mode) or omit it (create mode).
// =============================================================

'use client';

import { trpc } from '@/lib/trpc/client';
import { PREMIUM_STRATEGIES, type PremiumStrategy } from '@insurance-saas/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { JsonTextarea } from './json-textarea';

type ProductTypeRow = {
  id: string;
  code: string;
  name: string;
  premiumStrategy: string;
  schema: unknown;
  planSchema: unknown;
  parsingRules: unknown;
  displayTemplate: unknown;
  version: number;
};

type Props = {
  initial?: ProductTypeRow;
};

const EMPTY_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
};

const EMPTY_PLAN_SCHEMA = {
  type: 'object',
  required: ['code', 'name'],
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    stacksOn: { type: ['string', 'null'] },
    selectionMode: { enum: ['broker_default', 'employee_flex'], default: 'broker_default' },
  },
};

export function ProductTypeForm({ initial }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const isEdit = initial !== undefined;

  const create = trpc.productTypes.create.useMutation({
    onSuccess: async () => {
      await utils.productTypes.list.invalidate();
      router.push('/admin/catalogue/product-types');
    },
    onError: (err) => setFormError(err.message),
  });
  const update = trpc.productTypes.update.useMutation({
    onSuccess: async () => {
      await utils.productTypes.list.invalidate();
      if (initial) await utils.productTypes.byId.invalidate({ id: initial.id });
      router.push('/admin/catalogue/product-types');
    },
    onError: (err) => setFormError(err.message),
  });

  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [premiumStrategy, setPremiumStrategy] = useState<PremiumStrategy>(
    (initial?.premiumStrategy as PremiumStrategy) ?? PREMIUM_STRATEGIES[0],
  );
  const [schema, setSchema] = useState<{ value: unknown; valid: boolean }>({
    value: initial?.schema ?? EMPTY_SCHEMA,
    valid: true,
  });
  const [planSchema, setPlanSchema] = useState<{ value: unknown; valid: boolean }>({
    value: initial?.planSchema ?? EMPTY_PLAN_SCHEMA,
    valid: true,
  });
  const [parsingRules, setParsingRules] = useState<{ value: unknown; valid: boolean }>({
    value: initial?.parsingRules ?? null,
    valid: true,
  });
  const [displayTemplate, setDisplayTemplate] = useState<{ value: unknown; valid: boolean }>({
    value: initial?.displayTemplate ?? null,
    valid: true,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const allValid = schema.valid && planSchema.valid && parsingRules.valid && displayTemplate.valid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!allValid) {
      setFormError('Fix the JSON errors above before saving.');
      return;
    }
    const payload = {
      code: code.trim(),
      name: name.trim(),
      premiumStrategy,
      schema: schema.value as Record<string, unknown>,
      planSchema: planSchema.value as Record<string, unknown>,
      parsingRules: parsingRules.value as Record<string, unknown> | null,
      displayTemplate: displayTemplate.value as Record<string, unknown> | null,
    };
    if (isEdit && initial) {
      update.mutate({ id: initial.id, data: payload });
    } else {
      create.mutate(payload);
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <>
      <section className="section">
        <p className="eyebrow">
          <Link href="/admin/catalogue/product-types">← Product types</Link>
        </p>
        <h1>{isEdit ? `Edit ${initial.code}` : 'New product type'}</h1>
        {isEdit ? (
          <p className="field-help">
            Current version: <code>v{initial.version}</code>. Saving bumps to v{initial.version + 1}
            .
          </p>
        ) : null}
      </section>

      <section className="section">
        <div className="card card-padded">
          <form onSubmit={submit} className="stack-4" style={{ maxWidth: '48rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
              <div className="field">
                <label className="field-label" htmlFor="pt-code">
                  Code
                </label>
                <input
                  id="pt-code"
                  className="input"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  pattern="^[A-Z][A-Z0-9_]*$"
                  placeholder="GHS"
                />
                <span className="field-help">Uppercase. Unique per tenant.</span>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="pt-name">
                  Name
                </label>
                <input
                  id="pt-name"
                  className="input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Group Hospital & Surgical"
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pt-strategy">
                Premium strategy
              </label>
              <select
                id="pt-strategy"
                className="select"
                value={premiumStrategy}
                onChange={(e) => setPremiumStrategy(e.target.value as PremiumStrategy)}
              >
                {PREMIUM_STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="field-help">
                Picks the calculation module under <code>server/premium-strategies/</code>.
              </span>
            </div>

            <JsonTextarea
              id="pt-schema"
              label="Product schema"
              helpText="JSON Schema for product-instance fields (insurer, eligibility, age limits, …)."
              initial={schema.value}
              required
              onValueChange={(value, valid) => setSchema({ value, valid })}
            />

            <JsonTextarea
              id="pt-plan-schema"
              label="Plan schema"
              helpText="JSON Schema for plan rows. Should include code, name, stacksOn, selectionMode."
              initial={planSchema.value}
              required
              onValueChange={(value, valid) => setPlanSchema({ value, valid })}
            />

            <JsonTextarea
              id="pt-parsing"
              label="Parsing rules"
              helpText="Optional. Excel parser hints per insurer template (S29-S32). Leave blank if none."
              initial={parsingRules.value}
              nullable
              onValueChange={(value, valid) => setParsingRules({ value, valid })}
            />

            <JsonTextarea
              id="pt-display"
              label="Display template"
              helpText="Optional. Phase 2 employee portal card rendering. Leave blank if none."
              initial={displayTemplate.value}
              nullable
              onValueChange={(value, valid) => setDisplayTemplate({ value, valid })}
            />

            {formError ? <p className="field-error">{formError}</p> : null}

            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={pending || !allValid}>
                {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create product type'}
              </button>
              <Link href="/admin/catalogue/product-types" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
