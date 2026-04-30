// Inline match-count display for the predicate builder.
// Four states: not-ready · debouncing · loading · resolved.

interface MatchPreviewProps {
  ready: boolean;
  pending: boolean;
  loading: boolean;
  error: string | null;
  matched: number | null;
  total: number | null;
}

export function MatchPreview({
  ready,
  pending,
  loading,
  error,
  matched,
  total,
}: MatchPreviewProps) {
  if (!ready) return <span className="field-help">Build a complete condition to see matches.</span>;
  if (pending) return <span className="field-help">Waiting for typing to settle…</span>;
  if (loading) return <span className="field-help">Counting…</span>;
  if (error) return <span className="field-error">Preview failed: {error}</span>;
  if (matched === null || total === null) return null;
  if (total === 0) {
    return (
      <span className="field-help">
        No employees on this client yet — add employees to see live counts.
      </span>
    );
  }
  return (
    <span>
      Matches <strong>{matched}</strong> of {total} employee{total === 1 ? '' : 's'}.
    </span>
  );
}
