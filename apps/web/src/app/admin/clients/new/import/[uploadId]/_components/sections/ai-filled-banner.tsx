// =============================================================
// AiFilledBanner — small info card at the top of a section showing
// "this was auto-filled by AI extraction; review and adjust".
//
// Render only when `aiFilled === true`. The wizard-shell flips
// `aiFilled` to false the moment the broker edits a field in the
// section, so the banner self-dismisses on first interaction.
// =============================================================

'use client';

type Props = {
  aiFilled: boolean;
  // Optional one-line context, e.g. "from the AI's discovery pass"
  // or "from the deterministic parser".
  hint?: string;
};

export function AiFilledBanner({ aiFilled, hint }: Props) {
  if (!aiFilled) return null;
  return (
    <div
      role="note"
      aria-label="auto-filled by AI"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--accent-tint)',
        border: '1px solid var(--accent-soft)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 'var(--space-4)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
      }}
    >
      <span aria-hidden style={{ fontSize: 'var(--text-md)' }}>
        ✨
      </span>
      <div>
        <strong style={{ color: 'var(--text-primary)' }}>Auto-filled by AI extraction.</strong>{' '}
        Review the values below and edit anything that looks wrong — the badge in the left rail will
        flip to <em>Edited</em> once you change a field.
        {hint ? (
          <>
            <br />
            <span style={{ color: 'var(--text-tertiary)' }}>{hint}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
