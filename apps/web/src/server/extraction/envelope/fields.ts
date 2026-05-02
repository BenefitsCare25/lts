// Field constructor helpers — wrap raw cell values into FieldEnvelope shapes
// with deterministic confidence scoring.
//
// Confidence model (deterministic):
//   1.0 — non-empty cell at a known parsing-rules coordinate
//   0.6 — value parsed via regex from a recognised text pattern
//   0.3 — fallback / inferred / placeholder

import type { NumberField, PeriodField, SourceRef, StringField } from './types';

// `exactOptionalPropertyTypes: true` requires us to omit `sourceRef`
// when it's not provided rather than setting it to `undefined`. The
// helpers below build the envelope with conditional spreads.
export const stringField = (raw: unknown, sourceRef?: SourceRef): StringField => {
  const trimmed = raw == null ? '' : String(raw).trim();
  return {
    value: trimmed.length > 0 ? trimmed : null,
    raw,
    confidence: trimmed.length > 0 ? 1.0 : 0,
    ...(sourceRef ? { sourceRef } : {}),
  };
};

// Detect placeholder values commonly used in placement slips when a
// number isn't yet assigned (e.g. "TBA", "TBC", "Pending", "N/A").
// Returns true when the trimmed string is one of those.
const POLICY_NUMBER_PLACEHOLDER_RE = /^(?:tba|tbc|tbd|pending|n\.?\s*a\.?|n\/a|nil|none|-+)$/i;
export const looksLikePlaceholder = (s: string): boolean =>
  POLICY_NUMBER_PLACEHOLDER_RE.test(s.trim());

// Like `stringField` but treats placeholder strings (TBA, TBC, pending,
// N/A, etc.) as null with confidence 0 — preserving the original raw
// value so the wizard can show "captured but unassigned" hints.
export const policyNumberField = (raw: unknown, sourceRef?: SourceRef): StringField => {
  const trimmed = raw == null ? '' : String(raw).trim();
  if (trimmed.length === 0 || looksLikePlaceholder(trimmed)) {
    return {
      value: null,
      raw,
      confidence: 0,
      ...(sourceRef ? { sourceRef } : {}),
    };
  }
  return {
    value: trimmed,
    raw,
    confidence: 1.0,
    ...(sourceRef ? { sourceRef } : {}),
  };
};

export const numberField = (raw: unknown, sourceRef?: SourceRef): NumberField => {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return {
    value: Number.isFinite(n) ? n : null,
    raw,
    confidence: Number.isFinite(n) ? 1.0 : 0,
    ...(sourceRef ? { sourceRef } : {}),
  };
};

// Period of insurance text → {from, to}. Slip format:
//   "01/01/2026 - 31/12/2026"  or  "01-Jan-2026 to 31-Dec-2026"
// Returns null on parse failure; broker fills the date pickers.
export function parsePeriod(raw: unknown, sourceRef?: SourceRef): PeriodField {
  const text = raw == null ? '' : String(raw).trim();
  const ref = sourceRef ? { sourceRef } : {};
  if (!text) {
    return { value: null, raw, confidence: 0, ...ref };
  }
  // Parse failure: confidence 0 (not 0.3) so the wizard treats this
  // exactly like "field absent" rather than "low-confidence value
  // present" — the latter mis-styles the form input as if it has data.
  const segments = text.split(/\s*(?:-|to|→|–)\s*/);
  if (segments.length < 2) {
    return { value: null, raw, confidence: 0, ...ref };
  }
  const from = parseDmyOrIso(segments[0]);
  const to = parseDmyOrIso(segments[1]);
  if (!from || !to) {
    return { value: null, raw, confidence: 0, ...ref };
  }
  return { value: { from, to }, raw, confidence: 0.9, ...ref };
}

export function parseDmyOrIso(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // dd/mm/yyyy
  const dmy = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const yyyy = y && y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`;
  }
  // dd-MMM-yyyy
  const months: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const mmm = trimmed.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3})[a-z]*[\s\-/]+(\d{2,4})$/);
  if (mmm) {
    const [, d, mon, y] = mmm;
    const m = months[(mon ?? '').toLowerCase()];
    if (!m) return null;
    const yyyy = y && y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m}-${d?.padStart(2, '0')}`;
  }
  return null;
}
