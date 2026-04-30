// =============================================================
// PolicyEntitiesSection — editable table of legal entities under
// the master policy. Pre-seeded from parser.policyEntities; broker
// adjusts the master flag, edits headcount, adds rows for entities
// the parser missed.
// =============================================================

'use client';

import { Card } from '@/components/ui';
import type { DraftFormState } from './_registry';

type Props = {
  form: DraftFormState;
  setForm: React.Dispatch<React.SetStateAction<DraftFormState>>;
};

export function PolicyEntitiesSection({ form, setForm }: Props) {
  const update = (
    index: number,
    patch: Partial<DraftFormState['policyEntities'][number]>,
  ) => {
    setForm((prev) => ({
      ...prev,
      policyEntities: prev.policyEntities.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));
  };

  const setMaster = (index: number) => {
    setForm((prev) => ({
      ...prev,
      policyEntities: prev.policyEntities.map((e, i) => ({ ...e, isMaster: i === index })),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({
      ...prev,
      policyEntities: [
        ...prev.policyEntities,
        {
          legalName: '',
          policyNumber: '',
          address: '',
          headcountEstimate: null,
          isMaster: prev.policyEntities.length === 0,
        },
      ],
    }));
  };

  const removeRow = (index: number) => {
    setForm((prev) => {
      const removed = prev.policyEntities[index];
      const next = prev.policyEntities.filter((_, i) => i !== index);
      // If we removed the master, promote the first remaining row.
      if (removed?.isMaster && next.length > 0) {
        next[0] = { ...next[0], isMaster: true } as (typeof next)[number];
      }
      return { ...prev, policyEntities: next };
    });
  };

  const masterCount = form.policyEntities.filter((e) => e.isMaster).length;

  return (
    <>
      <h2>Policy entities</h2>

      <section className="section">
        <Card className="card-padded">
          <p className="field-help mb-3">
            Each row is a legal entity covered by the master policy. Pick exactly one entity as the
            master — its policy number is the headline policy number on documents.
          </p>

          {form.policyEntities.length === 0 ? (
            <p className="field-help mb-3">
              No entities yet. The parser didn&rsquo;t detect any from the slip; add them below.
            </p>
          ) : null}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Master</th>
                  <th>Legal name</th>
                  <th>Policy number</th>
                  <th>Address (optional)</th>
                  <th>Headcount</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {form.policyEntities.map((row, idx) => (
                  <tr key={`pe-${idx}-${row.policyNumber || row.legalName}`}>
                    <td>
                      <input
                        type="radio"
                        name="master-entity"
                        checked={row.isMaster}
                        onChange={() => setMaster(idx)}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={row.legalName}
                        onChange={(e) => update(idx, { legalName: e.target.value })}
                        required
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={row.policyNumber}
                        onChange={(e) => update(idx, { policyNumber: e.target.value })}
                        required
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={row.address}
                        onChange={(e) => update(idx, { address: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={row.headcountEstimate ?? ''}
                        onChange={(e) =>
                          update(idx, {
                            headcountEstimate: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeRow(idx)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row mt-3">
            <button type="button" className="btn btn-ghost" onClick={addRow}>
              + Add entity
            </button>
          </div>

          {form.policyEntities.length > 0 && masterCount === 0 ? (
            <p className="field-error mt-3">Pick one entity as the master.</p>
          ) : null}
          {masterCount > 1 ? (
            <p className="field-error mt-3">Only one entity can be the master.</p>
          ) : null}
        </Card>
      </section>
    </>
  );
}
