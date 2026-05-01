// =============================================================
// ExtractionProgress — live status card for the AI extraction run.
//
// Drives off WizardAiBundle.live (populated by jobs/extraction.ts as
// the runner streams events). Polled at 2s by the wizard shell, so
// updates feel real-time without WebSockets.
//
// Layout:
//   [stage label]                                  [elapsed time]
//   [progress bar — animated 0→100%]
//   [Discovery]  [Products N/M]  [Finalising]   ← stage steps
//   [per-product list with status icons]
//
// Visual rules:
//   - Semantic CSS variables only (no hardcoded colours)
//   - Full perimeter borders only (no directional accent borders —
//     project rule from CLAUDE.md)
//   - prefers-reduced-motion respected on the bar shimmer
// =============================================================

'use client';

import { Card } from '@/components/ui';
import { useEffect, useState } from 'react';
import type { LiveStage, WizardAiBundle } from './sections/_types';

type Props = {
  // Subset of the bundle the card actually renders. Keeps callers
  // from threading the whole bundle when they only need progress.
  live: NonNullable<WizardAiBundle['live']>;
};

export function ExtractionProgress({ live }: Props) {
  const elapsedSec = useElapsedSeconds(live.startedAt);
  const total = live.productKeys.length;
  const completed = live.completedCount;
  const failed = Object.values(live.statuses).filter((s) => s === 'failed').length;
  const percent = calcPercent(live.stage, completed, total);
  const stageLabel = stageHeading(live.stage, completed, total);

  return (
    <Card
      className="card-padded"
      style={{
        borderColor: 'var(--accent-soft)',
        background: 'var(--accent-tint)',
      }}
    >
      <div
        className="row mb-3"
        style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}
      >
        <div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: 'var(--space-1)',
            }}
          >
            AI extraction in progress
          </div>
          <h3 className="mb-0">{stageLabel}</h3>
        </div>
        <div
          aria-label="elapsed time"
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {formatElapsed(elapsedSec)}
        </div>
      </div>

      <ProgressBar percent={percent} />

      <div
        className="mt-3"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}
      >
        <StageStep
          label="Discovery"
          status={
            live.stage === 'AI_DISCOVERY'
              ? 'running'
              : live.productKeys.length > 0
                ? 'done'
                : 'pending'
          }
        />
        <StageStep
          label={total > 0 ? `Extract (${completed}/${total})` : 'Extract products'}
          status={
            live.stage !== 'AI_PRODUCTS'
              ? 'pending'
              : completed === total && total > 0
                ? 'done'
                : 'running'
          }
        />
        <StageStep
          label="Finalise"
          status={
            live.stage === 'AI_PRODUCTS' && completed === total && total > 0 ? 'running' : 'pending'
          }
        />
      </div>

      {total > 0 ? (
        <div
          className="mt-4"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {live.productKeys.map((key) => {
            const status = live.statuses[key] ?? 'queued';
            return <ProductRow key={key} productKey={key} status={status} />;
          })}
        </div>
      ) : null}

      <p className="field-help mb-0 mt-3" style={{ color: 'var(--text-tertiary)' }}>
        Keep editing other sections — the wizard auto-fills sections as products complete.
        {failed > 0
          ? ` ${failed} product${failed === 1 ? '' : 's'} failed (see warnings after the run).`
          : ''}
      </p>
    </Card>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="AI extraction progress"
      tabIndex={-1}
      style={{
        height: 8,
        width: '100%',
        background: 'var(--bg-active)',
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${percent}%`,
          background: 'linear-gradient(90deg, var(--accent) 0%, var(--color-info) 100%)',
          borderRadius: 'var(--radius-pill)',
          transition: 'width 0.5s cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      />
    </div>
  );
}

function StageStep({ label, status }: { label: string; status: 'pending' | 'running' | 'done' }) {
  const tone = status === 'done' ? 'success' : status === 'running' ? 'accent' : 'muted';
  const bg =
    tone === 'success'
      ? 'var(--confidence-high-soft)'
      : tone === 'accent'
        ? 'var(--accent-soft)'
        : 'var(--bg-hover)';
  const fg =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'accent'
        ? 'var(--accent)'
        : 'var(--text-tertiary)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: bg,
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: fg,
        fontWeight: 500,
      }}
    >
      <StatusDot status={status} />
      <span>{label}</span>
    </div>
  );
}

function StatusDot({
  status,
}: { status: 'pending' | 'running' | 'done' | 'queued' | 'ok' | 'failed' }) {
  if (status === 'done' || status === 'ok') {
    return <CheckIcon color="var(--color-success)" />;
  }
  if (status === 'failed') {
    return <CrossIcon color="var(--color-danger)" />;
  }
  if (status === 'running') {
    return <Spinner color="var(--accent)" />;
  }
  // pending / queued
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: '1.5px solid var(--text-quaternary)',
      }}
    />
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0 }}>
      <title>Done</title>
      <circle cx="7" cy="7" r="7" fill={color} />
      <path
        d="M3.5 7.2 L6 9.5 L10.5 4.8"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CrossIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0 }}>
      <title>Failed</title>
      <circle cx="7" cy="7" r="7" fill={color} />
      <path
        d="M4.5 4.5 L9.5 9.5 M9.5 4.5 L4.5 9.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ flexShrink: 0, animation: 'extraction-spin 0.9s linear infinite' }}
    >
      <title>In progress</title>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray="42 14"
        strokeLinecap="round"
        opacity="0.85"
      />
      <style>{`@keyframes extraction-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { svg[style*="extraction-spin"] { animation: none !important; } }`}</style>
    </svg>
  );
}

function ProductRow({
  productKey,
  status,
}: {
  productKey: string;
  status: 'queued' | 'running' | 'ok' | 'failed';
}) {
  const fg =
    status === 'ok'
      ? 'var(--color-success)'
      : status === 'failed'
        ? 'var(--color-danger)'
        : status === 'running'
          ? 'var(--text-primary)'
          : 'var(--text-tertiary)';
  const label =
    status === 'ok'
      ? 'extracted'
      : status === 'failed'
        ? 'failed'
        : status === 'running'
          ? 'in progress'
          : 'queued';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-1) var(--space-2)',
        background: status === 'running' ? 'var(--bg-hover)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-sm)',
        color: fg,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <StatusDot status={status} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
        {productKey}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-quaternary)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function calcPercent(stage: LiveStage, completed: number, total: number): number {
  // Discovery alone weighted at ~15% of perceived progress.
  // Per-product fan-out is the bulk (15-95%).
  if (stage === 'AI_DISCOVERY') return 8;
  if (total === 0) return 12;
  return Math.min(95, 15 + Math.round((completed / total) * 80));
}

function stageHeading(stage: LiveStage, completed: number, total: number): string {
  if (stage === 'AI_DISCOVERY') return 'Identifying products in the workbook…';
  if (total === 0) return 'Preparing per-product extraction…';
  if (completed === total) return 'Finalising extraction…';
  return `Extracting product ${completed + 1} of ${total}`;
}
