// =============================================================
// Reusable JSON-textarea field with parse-on-blur validation.
// Emits the parsed value (or null when blank) via `onValueChange`.
// =============================================================

'use client';

import { useEffect, useState } from 'react';

type Props = {
  id: string;
  label: string;
  helpText?: string;
  initial: unknown;
  required?: boolean;
  nullable?: boolean;
  onValueChange: (value: unknown, valid: boolean) => void;
};

export function JsonTextarea({
  id,
  label,
  helpText,
  initial,
  required,
  nullable,
  onValueChange,
}: Props) {
  const [text, setText] = useState(() => formatInitial(initial, nullable));
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: parent's onValueChange identity isn't stable; we only want to re-emit when the text changes
  useEffect(() => {
    parseAndEmit(text, required, nullable, setError, onValueChange);
  }, [text]);

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        style={{ minHeight: '14rem', fontFamily: 'var(--font-mono)' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {error ? (
        <span className="field-error">{error}</span>
      ) : helpText ? (
        <span className="field-help">{helpText}</span>
      ) : null}
    </div>
  );
}

function formatInitial(value: unknown, nullable: boolean | undefined): string {
  if (value === null || value === undefined) return nullable ? '' : '{}';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function parseAndEmit(
  text: string,
  required: boolean | undefined,
  nullable: boolean | undefined,
  setError: (e: string | null) => void,
  emit: (value: unknown, valid: boolean) => void,
): void {
  if (text.trim() === '') {
    if (nullable) {
      setError(null);
      emit(null, true);
      return;
    }
    if (required) {
      setError('Required.');
      emit(null, false);
      return;
    }
    setError(null);
    emit({}, true);
    return;
  }
  try {
    const parsed = JSON.parse(text);
    setError(null);
    emit(parsed, true);
  } catch (err) {
    setError(`Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`);
    emit(null, false);
  }
}
