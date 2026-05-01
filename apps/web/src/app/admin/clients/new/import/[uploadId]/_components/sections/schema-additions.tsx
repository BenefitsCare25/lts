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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SectionId } from './_registry';
import { suggestionsFromDraft } from './_types';

type Resolution = 'ADD' | 'MAP' | 'DROP';

type Decision = { resolution: Resolution; mapTo?: string };

type Props = {
  draft: { id: string; progress: unknown };
  markSectionDirty?: (id: SectionId) => void;
};

export function SchemaAdditionsSection({ draft, markSectionDirty }: Props) {
  const suggestions = suggestionsFromDraft(draft.progress);
  const employeeSchema = trpc.employeeSchema.get.useQuery();

  // Hydrate from draft.progress.brokerOverrides.schemaDecisions when
  // present so reload preserves the broker's choices. Otherwise default
  // every missing field to ADD.
  const persisted = useMemo<Record<string, Decision>>(() => {
    if (!draft.progress || typeof draft.progress !== 'object' || Array.isArray(draft.progress)) {
      return {};
    }
    const obj = draft.progress as { brokerOverrides?: Record<string, unknown> };
    const v = obj.brokerOverrides?.schemaDecisions as Record<string, Decision> | undefined;
    return v && typeof v === 'object' ? { ...v } : {};
  }, [draft.progress]);

  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    if (Object.keys(persisted).length > 0) return persisted;
    const init: Record<string, Decision> = {};
    for (const f of suggestions.missingPredicateFields) init[f.fieldPath] = { resolution: 'ADD' };
    return init;
  });

  // Debounced persistence to draft.progress.brokerOverrides.schemaDecisions.
  const saveOverride = trpc.extractionDrafts.updateBrokerOverrides.useMutation();
  // Stable ref to mutate avoids re-arming the timer on every render.
  // tRPC's useMutation returns a fresh object per render but the
  // mutate handler itself is internally stable; we ref it to be safe.
  const mutateRef = useRef(saveOverride.mutate);
  useEffect(() => {
    mutateRef.current = saveOverride.mutate;
  }, [saveOverride.mutate]);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      mutateRef.current({
        draftId: draft.id,
        namespace: 'schemaDecisions',
        value: decisions,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [decisions, draft.id]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    markSectionDirty?.('schema_additions');
  }, [markSectionDirty]);

  // Wrapper around setDecisions that flips the dirty flag so reloads
  // and apply read the same persisted state.
  const updateDecision = useCallback(
    (fieldPath: string, decision: Decision) => {
      markDirty();
      setDecisions((prev) => ({ ...prev, [fieldPath]: decision }));
    },
    [markDirty],
  );

  const existingFields = useMemo(() => {
    if (!employeeSchema.data) return [];
    return (
      employeeSchema.data.fields as Array<{ name: string; label: string; type: string }>
    ).filter((f) => f.name);
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
                    {field.referencedBy.length === 0 ? '—' : field.referencedBy.join(', ')}
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
                        onChange={() => updateDecision(field.fieldPath, { resolution: 'ADD' })}
                      />
                      Add as CUSTOM field to employee schema
                    </label>
                    <label className="chip">
                      <input
                        type="radio"
                        name={`res-${field.fieldPath}`}
                        value="MAP"
                        checked={decision.resolution === 'MAP'}
                        onChange={() => {
                          const existing = decisions[field.fieldPath];
                          const next: Decision = {
                            resolution: 'MAP',
                            ...(existing?.mapTo ? { mapTo: existing.mapTo } : {}),
                          };
                          updateDecision(field.fieldPath, next);
                        }}
                      />
                      Map to existing field
                    </label>
                    {decision.resolution === 'MAP' ? (
                      <>
                        <select
                          className="input"
                          style={{ marginLeft: '1.5rem', width: 'auto' }}
                          value={decision.mapTo ?? ''}
                          onChange={(e) =>
                            updateDecision(
                              field.fieldPath,
                              e.target.value === ''
                                ? { resolution: 'MAP' }
                                : { resolution: 'MAP', mapTo: e.target.value },
                            )
                          }
                          aria-invalid={decision.mapTo ? undefined : true}
                        >
                          <option value="">— Pick a field —</option>
                          {existingFields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label} ({f.name}, {f.type})
                            </option>
                          ))}
                        </select>
                        {decision.mapTo ? null : (
                          <p
                            className="field-help text-warn"
                            style={{ marginLeft: '1.5rem', marginTop: '0.25rem' }}
                          >
                            Pick a target field, or switch to ADD or DROP.
                          </p>
                        )}
                      </>
                    ) : null}
                    <label className="chip">
                      <input
                        type="radio"
                        name={`res-${field.fieldPath}`}
                        value="DROP"
                        checked={decision.resolution === 'DROP'}
                        onChange={() => updateDecision(field.fieldPath, { resolution: 'DROP' })}
                      />
                      Drop predicate term ({field.referencedBy.length} predicate
                      {field.referencedBy.length === 1 ? '' : 's'} affected)
                    </label>
                  </div>
                </fieldset>
              </div>
            );
          })}

          <div className="mt-3">
            <h4 className="mb-2">Resolution summary</h4>
            <ul className="kv-list">
              {Object.entries(decisions).map(([fieldPath, decision]) => {
                const incomplete = decision.resolution === 'MAP' && !decision.mapTo;
                return (
                  <li key={fieldPath} className={incomplete ? 'text-warn' : undefined}>
                    <code>{fieldPath}</code> →{' '}
                    {decision.resolution === 'ADD'
                      ? 'add as CUSTOM'
                      : decision.resolution === 'MAP'
                        ? `map to ${decision.mapTo ?? 'unresolved (pick a target)'}`
                        : 'drop term'}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </section>
    </>
  );
}
