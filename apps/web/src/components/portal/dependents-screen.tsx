'use client';

import { Field } from '@/components/ui';
import { RELATION_LABEL } from '@/lib/dependent-labels';
import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';

type Relation = 'spouse' | 'child' | 'parent';

type FormMode =
  | null
  | { type: 'add' }
  | { type: 'edit'; depId: string; currentData: Record<string, unknown>; currentRelation: Relation }
  | { type: 'remove'; depId: string; name: string };

type FormValues = {
  fullName: string;
  dateOfBirth: string;
  relation: Relation | '';
};

const EMPTY_FORM: FormValues = { fullName: '', dateOfBirth: '', relation: '' };

function formValuesToDepData(values: FormValues): Record<string, unknown> {
  const data: Record<string, unknown> = { full_name: values.fullName };
  if (values.dateOfBirth) data.date_of_birth = values.dateOfBirth;
  return data;
}

function DependentForm({
  initial,
  relationFixed,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  initial: FormValues;
  relationFixed?: Relation;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const set =
    (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-3 mt-3">
      {!relationFixed && (
        <Field label="Relationship" htmlFor="dep-relation" required>
          <select
            id="dep-relation"
            className="input"
            value={values.relation}
            onChange={set('relation')}
          >
            <option value="">— select —</option>
            <option value="spouse">Spouse</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
          </select>
        </Field>
      )}
      <Field label="Full name" htmlFor="dep-name" required>
        <input
          id="dep-name"
          type="text"
          className="input"
          value={values.fullName}
          onChange={set('fullName')}
        />
      </Field>
      <Field label="Date of birth" htmlFor="dep-dob">
        <input
          id="dep-dob"
          type="date"
          className="input"
          value={values.dateOfBirth}
          onChange={set('dateOfBirth')}
        />
      </Field>
      {error && <p className="field-error">{error}</p>}
      <p className="text-xs muted">This change requires broker approval before taking effect.</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={submitting || !values.fullName.trim() || (!relationFixed && !values.relation)}
          onClick={() =>
            onSubmit({ ...values, relation: (relationFixed ?? values.relation) as Relation | '' })
          }
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DependentsScreen() {
  const utils = trpc.useUtils();
  const { data: dependents, isLoading, error } = trpc.portal.dependents.list.useQuery();
  const { data: pending } = trpc.portal.dependents.pendingRequests.useQuery();

  const addMutation = trpc.portal.dependents.requestAdd.useMutation();
  const editMutation = trpc.portal.dependents.requestEdit.useMutation();
  const removeMutation = trpc.portal.dependents.requestRemove.useMutation();

  const [mode, setMode] = useState<FormMode>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (isLoading) return <p className="muted">Loading your dependents…</p>;
  if (error) return <p className="field-error">{error.message}</p>;

  const pendingCount = pending?.length ?? 0;

  async function submitAdd(values: FormValues) {
    setMutationError(null);
    try {
      await addMutation.mutateAsync({ data: formValuesToDepData(values), relation: values.relation as Relation });
      await utils.portal.dependents.pendingRequests.invalidate();
      setMode(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to submit.');
    }
  }

  async function submitEdit(depId: string, values: FormValues) {
    setMutationError(null);
    try {
      await editMutation.mutateAsync({ dependentId: depId, data: formValuesToDepData(values), relation: values.relation as Relation });
      await utils.portal.dependents.pendingRequests.invalidate();
      setMode(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to submit.');
    }
  }

  async function submitRemove(depId: string) {
    setMutationError(null);
    try {
      await removeMutation.mutateAsync({ dependentId: depId });
      await utils.portal.dependents.pendingRequests.invalidate();
      setMode(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to submit.');
    }
  }

  const isSubmitting = addMutation.isPending || editMutation.isPending || removeMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      {pendingCount > 0 && (
        <div className="card card-padded">
          <h3 className="text-sm font-semibold mb-3">Pending Change Requests</h3>
          <ul className="flex flex-col gap-2">
            {pending?.map((req) => (
              <li key={req.id} className="flex items-center justify-between text-sm">
                <span>
                  {req.action === 'ADD' && 'Add '}
                  {req.action === 'EDIT' && 'Update '}
                  {req.action === 'REMOVE' && 'Remove '}
                  {RELATION_LABEL[req.relation] ?? req.relation}
                  {req.action !== 'REMOVE' &&
                    typeof req.data === 'object' &&
                    req.data !== null &&
                    'full_name' in (req.data as Record<string, unknown>) &&
                    ` — ${(req.data as Record<string, unknown>).full_name}`}
                </span>
                <span className="muted">Pending review</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card card-padded">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Registered Dependents</h3>
          {mode === null && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setMutationError(null);
                setMode({ type: 'add' });
              }}
            >
              Add dependent
            </button>
          )}
        </div>

        {mode?.type === 'add' && (
          <DependentForm
            initial={EMPTY_FORM}
            onSubmit={submitAdd}
            onCancel={() => setMode(null)}
            submitting={isSubmitting}
            error={mutationError}
          />
        )}

        {!dependents?.length && mode?.type !== 'add' ? (
          <p className="muted">No registered dependents.</p>
        ) : (
          <ul className="flex flex-col gap-3 mt-2">
            {dependents?.map((dep) => {
              const depData = (dep.data ?? {}) as Record<string, unknown>;
              const depName = String(depData.full_name ?? '—');
              const depDob = depData.date_of_birth ? String(depData.date_of_birth) : null;

              return (
                <li key={dep.id} className="pb-3 border-b border-border last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{depName}</p>
                      <p className="text-xs muted">
                        {RELATION_LABEL[dep.relation] ?? dep.relation}
                        {depDob && ` · DOB: ${depDob}`}
                      </p>
                    </div>
                    {mode === null && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setMutationError(null);
                            setMode({
                              type: 'edit',
                              depId: dep.id,
                              currentData: depData,
                              currentRelation: dep.relation as Relation,
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setMutationError(null);
                            setMode({ type: 'remove', depId: dep.id, name: depName });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  {mode?.type === 'edit' && mode.depId === dep.id && (
                    <DependentForm
                      initial={{
                        fullName: String(mode.currentData.full_name ?? ''),
                        dateOfBirth: String(mode.currentData.date_of_birth ?? ''),
                        relation: mode.currentRelation,
                      }}
                      relationFixed={mode.currentRelation}
                      onSubmit={(values) => submitEdit(dep.id, values)}
                      onCancel={() => setMode(null)}
                      submitting={isSubmitting}
                      error={mutationError}
                    />
                  )}

                  {mode?.type === 'remove' && mode.depId === dep.id && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-sm">
                        Request removal of <strong>{mode.name}</strong>? This requires broker
                        approval.
                      </p>
                      {mutationError && <p className="field-error">{mutationError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => submitRemove(dep.id)}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? 'Submitting…' : 'Confirm removal request'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setMode(null)}
                          disabled={isSubmitting}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
