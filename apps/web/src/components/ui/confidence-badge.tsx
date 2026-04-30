// =============================================================
// ConfidenceBadge — shows extraction confidence in three states.
//
// Used in:
//   - Per-field <Field confidence={0.62}> (compact dot)
//   - Plan/benefit list rows (full pill with %)
//   - Product sidebar in the placement-slip review screen
//
// Threshold model (locked in plan):
//   ≥ 0.85 → high (green). Field accepted, no review needed.
//   0.6–0.85 → warn (amber). Broker should glance.
//   < 0.6 → low (red). Must be edited or explicitly accepted.
//
// `sourceRef` is shown in the title attribute on hover so brokers
// can trace any value back to the source slip cell.
// =============================================================

export type ConfidenceLevel = 'high' | 'warn' | 'low';

export interface SourceRef {
  sheet?: string;
  cell?: string;
  range?: string;
}

interface ConfidenceBadgeProps {
  confidence: number;
  variant?: 'dot' | 'pill';
  sourceRef?: SourceRef;
  className?: string;
}

export const CONFIDENCE_HIGH_THRESHOLD = 0.85;
export const CONFIDENCE_LOW_THRESHOLD = 0.6;

export function levelOf(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_HIGH_THRESHOLD) return 'high';
  if (confidence >= CONFIDENCE_LOW_THRESHOLD) return 'warn';
  return 'low';
}

function formatSourceRef(ref?: SourceRef): string | undefined {
  if (!ref) return undefined;
  const where = ref.cell ?? ref.range;
  if (ref.sheet && where) return `Sheet '${ref.sheet}', ${where}`;
  if (ref.sheet) return `Sheet '${ref.sheet}'`;
  if (where) return where;
  return undefined;
}

export function ConfidenceBadge({
  confidence,
  variant = 'pill',
  sourceRef,
  className,
}: ConfidenceBadgeProps) {
  const level = levelOf(confidence);
  const pct = Math.round(confidence * 100);
  const title = formatSourceRef(sourceRef);
  const classes = ['confidence-badge', `confidence-badge--${level}`];
  if (className) classes.push(className);

  if (variant === 'dot') {
    return (
      <span className={classes.join(' ')} title={title} aria-label={`Confidence ${pct}%`}>
        <span className="confidence-badge__dot" aria-hidden />
      </span>
    );
  }
  return (
    <span className={classes.join(' ')} title={title}>
      <span className="confidence-badge__dot" aria-hidden />
      <span>{pct}%</span>
    </span>
  );
}
