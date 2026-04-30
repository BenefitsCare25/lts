// =============================================================
// SchemaAdditionsSection — surfaces every field a suggested
// predicate references that doesn't exist in the tenant's
// EmployeeSchema yet. Each row offers three resolution paths:
//   ◉ Add as CUSTOM field
//   ○ Map to existing field
//   ○ Drop the predicate term (the predicate it referenced
//     becomes weaker but still saveable)
//
// Apply later commits the chosen actions: ADD inserts a CUSTOM
// row into EmployeeSchema.fields, MAP rewrites every predicate's
// "var" reference, DROP rewrites the predicate to omit the term.
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useMemo, useState } from 'react';
import { suggestionsFromDraft } from './_types';

type Resolution = 'ADD' | 'MAP' | 'DROP';

type Props = {
  draft: { progress: unknown };
};

export function SchemaAdditionsSection({ draft }: Props) {
  const suggestions = suggestionsFromDraft(draft.progress);
  const employeeSchema = trpc.employeeSchema.get.useQuery();

  // Local state — broker's resolution choice per field path.
  const [decisions, setDecisions] = useState<
    Record<string, { resolution: Resolution; mapTo?: string }>
  >(() => {
    const init: Record<string, { resolution: Resolution; mapTo?: string }> = {};
    for (const f of suggestions.missingPredicateFields) init[f.fieldPath] = { resolution: 'ADD' };
    return init;
  });

  const existingFields = useMemo(() => {
    if (!employeeSchema.data) return [];
    return (employeeSchema.data.fields as Array<{ name: string; label: string; type: string }>).filter(
      (f) => f.name,
    );
  }, [employeeSchema.data]);

  if (suggestions.missingPredicateFields.length === 0) {
    return (
      <>
        <h2>Schema additions</h2>
        <section className="section">
          <Card className="card-padded">
            <p className="text-good mb-0">
              ✓ Every suggested predicate references a field that already exists in your employee
              schema. Nothing to add.
            </p>
          </Card>
        </section>
      </>
    );
  }

  return (
    <>
      <h2>Schema additions</h2>
      <section className="section">
        <Card className="card-padded">
          <p className="field-help mb-3">
            The AI suggested {suggestions.missingPredicateFields.length} predicate
            {suggestions.missingPredicateFields.length === 1 ? '' : 's'} that reference fields not
            in your employee schema. Resolve each below — Apply commits your choices in the same
            transaction as everything else.
          </p>

          {suggestions.missingPredicateFields.map((field) => {
            const decision = decisions[field.fieldPath] ?? { resolution: 'ADD' as Resolution };
            return (
              <div key={field.fieldPath} className="card card-padded mb-3">
                <h4 className="mb-2">
                  <code>{field.fieldPath}</code>
                </h4>
                <ul className="kv-list">
                  <li>
                    <strong>Suggested type</strong>: {field.suggestedType}
                  </li>
                  <li>
                    <strong>Suggested label</strong>: {field.suggestedLabel}
                  </li>
                  <li>
                    <strong>Used by</strong>:{' '}
                    {field.referencedBy.length === 0
                      ? '—'
                      : field.referencedBy.join(', ')}
                  </li>
                </ul>

                <fieldset className="fieldset mt-3">
                  <legend>Resolution</legend>
                  <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <label className="chip">
                      <input
                        type="radio"
                        name={`res-${field.fieldPath}`}
                        value="ADD"
                        checked={decision.resolution === 'ADD'}
                        onChange={() =>
                          setDecisions((prev) => ({
                            ...prev,
                            [field.fieldPath]: { resolution: 'ADD' },
                          }))
                        }
                      />
                      Add as CUSTOM field to employee schema
                    </label>
                    <label className="chip">
                      <input
                        type="radio"
                        name={`res-${field.fieldPath}`}
                        value="MAP"
                        checked={decision.resolution === 'MAP'}
                        onChange={() =>
                          setDecisions((prev) => {
                            const existing = prev[field.fieldPath];
                            const next: { resolution: Resolution; mapTo?: string } = {
                              resolution: 'MAP',
                              ...(existing?.mapTo ? { mapTo: existing.mapTo } : {}),
                            };
                            return { ...prev, [field.fieldPath]: next };
                          })
                        }
                      />
                      Map to existing field
                    </label>
                    {decision.resolution === 'MAP' ? (
                      <select
                        className="input"
                        style={{ marginLeft: '1.5rem', width: 'auto' }}
                        value={decision.mapTo ?? ''}
                        onChange={(e) =>
                          setDecisions((prev) => ({
                            ...prev,
                            [field.fieldPath]: { resolution: 'MAP', mapTo: e.target.value },
                          }))
                        }
                      >
                        <option value="">— Pick a field —</option>
                        {existingFields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.label} ({f.name}, {f.type})
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <label className="chip">
                      <input
                        type="radio"
                        name={`res-${field.fieldPath}`}
                        value="DROP"
                        checked={decision.resolution === 'DROP'}
                        onChange={() =>
                          setDecisions((prev) => ({
                            ...prev,
                            [field.fieldPath]: { resolution: 'DROP' },
                          }))
                        }
                      />
                      Drop predicate term ({field.referencedBy.length}{' '}
                      predicate{field.referencedBy.length === 1 ? '' : 's'} affected)
                    </label>
                  </div>
                </fieldset>
              </div>
            );
          })}

          <div className="mt-3">
            <h4 className="mb-2">Resolution summary</h4>
            <ul className="kv-list">
              {Object.entries(decisions).map(([fieldPath, decision]) => (
                <li key={fieldPath}>
                  <code>{fieldPath}</code> →{' '}
                  {decision.resolution === 'ADD'
                    ? 'add as CUSTOM'
                    : decision.resolution === 'MAP'
                      ? `map to ${decision.mapTo ?? '— pick —'}`
                      : 'drop term'}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>
    </>
  );
}
