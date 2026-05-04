'use client';

// EmployeeListingSection — optional employee listing upload within the
// Source section. Extracts unique Category values from the file and stores
// them on ExtractionDraft.employeeCategories so the AI extraction prompt
// can use them as ground-truth employee group labels.
//
// The file itself is NOT persisted — only the extracted category strings.
// The broker uploads the same file later via the employee import screen
// to create the actual Employee rows.

import { Card } from '@/components/ui';
import { trpc } from '@/lib/trpc/client';
import { useRef, useState } from 'react';

export function EmployeeListingSection({
  draftId,
  initialCategories,
  onCategoriesUpdated,
}: {
  draftId: string;
  initialCategories: string[];
  onCategoriesUpdated: (categories: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [error, setError] = useState<string | null>(null);

  const attach = trpc.extractionDrafts.attachEmployeeListing.useMutation({
    onSuccess: (data) => {
      setCategories(data.categories);
      onCategoriesUpdated(data.categories);
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleFile = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result;
      if (!(arrayBuffer instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i] as number);
      }
      const fileBase64 = btoa(binary);
      attach.mutate({ draftId, fileBase64 });
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <section className="section">
      <Card className="card-padded">
        <h3 className="mb-1">Employee listing (optional)</h3>
        <p className="field-help mb-3">
          Upload your employee listing to help the AI match benefit groups to your actual employee
          categories. Only the <strong>Category</strong> column is read at this stage — no employee
          records are created. Upload the same file via the employee import screen later to create
          the records.
        </p>

        <div className="row" style={{ alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={attach.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {attach.isPending
              ? 'Reading…'
              : categories.length > 0
                ? 'Replace listing'
                : 'Choose file (.xlsx, .xls)'}
          </button>

          {categories.length > 0 ? (
            <span className="text-good" style={{ fontSize: 'var(--font-sm)' }}>
              ✓ {categories.length} {categories.length === 1 ? 'category' : 'categories'} found
            </span>
          ) : null}
        </div>

        {error ? <p className="field-error mt-2">{error}</p> : null}

        {categories.length > 0 ? (
          <div className="mt-3" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {categories.map((c) => (
              <span
                key={c}
                className="pill pill-muted"
                style={{ fontSize: 'var(--font-sm)' }}
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
