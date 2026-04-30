// =============================================================
// Field — wraps label + input + error + confidence badge.
//
// Replaces the field markup duplicated across 7 hand-rolled
// forms. Consumed by the new <Form> abstraction (RHF) and by the
// placement-slip review form which renders confidence-aware
// fields directly.
//
// When `confidence` is supplied the field colors itself per the
// threshold model and shows a badge next to the label. The
// underlying input is owned by the caller (uncontrolled or
// controlled — Field is presentational).
// =============================================================

import type { ReactNode } from 'react';
import { ConfidenceBadge, type SourceRef, levelOf } from './confidence-badge';

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  confidence?: number;
  sourceRef?: SourceRef;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  confidence,
  sourceRef,
  required,
  children,
  className,
}: FieldProps) {
  const classes = ['field'];
  if (typeof confidence === 'number') {
    classes.push(`field--confidence-${levelOf(confidence)}`);
  }
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')}>
      <label className="field-label flex items-center justify-between gap-2" htmlFor={htmlFor}>
        <span>
          {label}
          {required ? <span aria-hidden> *</span> : null}
        </span>
        {typeof confidence === 'number' ? (
          <ConfidenceBadge
            confidence={confidence}
            variant="dot"
            {...(sourceRef ? { sourceRef } : {})}
          />
        ) : null}
      </label>
      {children}
      {hint ? <span className="field-help">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
