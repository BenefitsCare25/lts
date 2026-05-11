'use client';

import { Card } from '@/components/ui';
import { readFileAsBase64 } from '@/lib/file';
import { trpc } from '@/lib/trpc/client';
import { useRef, useState } from 'react';

type UploadResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  affectedEmployeeIds?: string[];
};

function useFileUpload(
  mutation: ReturnType<
    | typeof trpc.ruleTables.engine.uploadEmployees.useMutation
    | typeof trpc.ruleTables.engine.uploadDependents.useMutation
  >,
  clientId: string,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    setResult(null);
    readFileAsBase64(file).then((fileBase64) =>
      mutation.mutate(
        { clientId, fileBase64 },
        {
          onSuccess: (data) => {
            setResult(data);
            setError(null);
          },
          onError: (err) => setError(err.message),
        },
      ),
    );
  };

  return { inputRef, result, error, isPending: mutation.isPending, handleFile };
}

function UploadSection({
  title,
  description,
  isPending,
  result,
  error,
  inputRef,
  onFile,
}: {
  title: string;
  description: string;
  isPending: boolean;
  result: UploadResult | null;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        {isPending ? 'Uploading...' : 'Choose file (.xlsx, .xls)'}
      </button>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {result && (
        <div className="mt-3">
          <div className="flex items-center gap-4 text-sm">
            <span>Total: {result.total}</span>
            <span className="text-emerald-600">Created: {result.created}</span>
            <span className="text-foreground">Updated: {result.updated}</span>
            <span className="text-muted-foreground">Skipped: {result.skipped}</span>
          </div>

          {result.affectedEmployeeIds && result.affectedEmployeeIds.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {result.affectedEmployeeIds.length} employee(s) affected
            </p>
          )}

          {result.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-red-600 mb-1">
                {result.errors.length} error(s)
              </p>
              <div className="max-h-48 overflow-y-auto border border-border rounded">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1 px-2 text-muted-foreground font-normal w-16">
                        Row
                      </th>
                      <th className="text-left py-1 px-2 text-muted-foreground font-normal">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={`${err.row}-${i}`} className="border-b border-border/50">
                        <td className="py-1 px-2 font-mono">{err.row}</td>
                        <td className="py-1 px-2">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DataUploadTab({ clientId }: { clientId: string }) {
  const employeeMutation = trpc.ruleTables.engine.uploadEmployees.useMutation();
  const dependentMutation = trpc.ruleTables.engine.uploadDependents.useMutation();

  const employee = useFileUpload(employeeMutation, clientId);
  const dependent = useFileUpload(dependentMutation, clientId);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <UploadSection
          title="Employee Listing"
          description="Upload an Excel file with employee data (Staff ID, Name, DOB, Salary, Grade, etc.). Existing employees matched by Staff ID will be updated."
          isPending={employee.isPending}
          result={employee.result}
          error={employee.error}
          inputRef={employee.inputRef}
          onFile={employee.handleFile}
        />
      </Card>

      <Card>
        <UploadSection
          title="Dependent Listing"
          description="Upload an Excel file with dependent data (Staff ID, Dependant Name, Relationship, DOB, etc.). Used by the flex engine to calculate wallet credits based on family composition."
          isPending={dependent.isPending}
          result={dependent.result}
          error={dependent.error}
          inputRef={dependent.inputRef}
          onFile={dependent.handleFile}
        />
      </Card>
    </div>
  );
}
