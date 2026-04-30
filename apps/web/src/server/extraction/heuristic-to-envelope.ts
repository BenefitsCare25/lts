// =============================================================
// Heuristic → ExtractedProduct[] envelope.
//
// Turns the deterministic parser's output into the shape declared
// by packages/catalogue-schemas/extracted-product.json. Every leaf
// becomes a {value, raw, confidence, sourceRef} envelope so the
// wizard can render confidence chips and source-cell hovers without
// caring whether the LLM stage ever ran.
//
// Confidence model (deterministic):
//   1.0 — non-empty cell at a known parsing-rules coordinate
//   0.6 — value parsed via regex from a recognised text pattern
//   0.3 — fallback / inferred / placeholder
//
// When the LLM stage runs (extractor.ts), it can up- or down-
// adjust confidences based on cross-cell consistency. Today,
// confidence is a deterministic function of "did the cell actually
// have content".
// =============================================================

import { COVER_BASIS_BY_STRATEGY, excelColumnIndex } from '@/server/catalogue/premium-strategy';
import type {
  ParseResult,
  ParsedPolicyEntity,
  ParsedProduct,
  ParsingRules,
} from '@/server/ingestion/parser';

export type SourceRef = {
  sheet?: string;
  cell?: string;
  range?: string;
};

export type FieldEnvelope<T> = {
  value: T | null;
  raw?: unknown;
  confidence: number;
  sourceRef?: SourceRef;
};

export type StringField = FieldEnvelope<string>;
export type NumberField = FieldEnvelope<number>;
export type PeriodField = FieldEnvelope<{ from: string; to: string }>;

export type PolicyEntityField = {
  legalName: string;
  policyNumber: string | null;
  address: string | null;
  isMaster: boolean;
  confidence: number;
  sourceRef?: SourceRef;
};

export type CategoryField = {
  category: string;
  headcount: number | null;
  sumInsuredFormula: string | null;
  participation: string | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type PlanField = {
  rawCode: string;
  rawName: string;
  code: string;
  name: string;
  coverBasis: 'per_cover_tier' | 'salary_multiple' | 'fixed_amount' | 'per_region';
  stacksOnRawCode: string | null;
  selectionMode: 'broker_default' | 'employee_flex';
  schedule: Record<string, unknown>;
  confidence: number;
  sourceRef?: SourceRef;
};

export type PremiumRateField = {
  planRawCode: string;
  coverTier: string | null;
  ratePerThousand: number | null;
  fixedAmount: number | null;
  blockLabel?: string | null;
  ageBand: { from: number; to: number } | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type BenefitField = {
  rawName: string;
  name: string;
  description: string | null;
  limits: Array<{
    planRawCode: string;
    amount: number | null;
    unit: string | null;
    rawText: string | null;
  }>;
  deductible: number | null;
  coInsurancePct: number | null;
  waitingPeriodDays: number | null;
  confidence: number;
  sourceRef?: SourceRef;
};

export type ExtractedProduct = {
  productTypeCode: string;
  insurerCode: string;
  header: {
    policyNumber: StringField;
    period: PeriodField;
    lastEntryAge: NumberField;
    administrationType: StringField;
    currency: StringField;
  };
  policyholder: {
    legalName: StringField;
    uen: StringField;
    address: StringField;
    businessDescription: StringField;
    insuredEntities: PolicyEntityField[];
  };
  eligibility: {
    freeText: StringField;
    categories: CategoryField[];
  };
  plans: PlanField[];
  premiumRates: PremiumRateField[];
  benefits: BenefitField[];
  extractionMeta: {
    overallConfidence: number;
    extractorVersion: string;
    warnings: string[];
  };
};

const EXTRACTOR_VERSION = 'heuristic-1.0';

// `exactOptionalPropertyTypes: true` requires us to omit `sourceRef`
// when it's not provided rather than setting it to `undefined`. The
// helpers below build the envelope with conditional spreads.
const stringField = (raw: unknown, sourceRef?: SourceRef): StringField => {
  const trimmed = raw == null ? '' : String(raw).trim();
  return {
    value: trimmed.length > 0 ? trimmed : null,
    raw,
    confidence: trimmed.length > 0 ? 1.0 : 0,
    ...(sourceRef ? { sourceRef } : {}),
  };
};

const numberField = (raw: unknown, sourceRef?: SourceRef): NumberField => {
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
function parsePeriod(raw: unknown, sourceRef?: SourceRef): PeriodField {
  const text = raw == null ? '' : String(raw).trim();
  const ref = sourceRef ? { sourceRef } : {};
  if (!text) {
    return { value: null, raw, confidence: 0, ...ref };
  }
  const segments = text.split(/\s*(?:-|to|→|–)\s*/);
  if (segments.length < 2) {
    return { value: null, raw, confidence: 0.3, ...ref };
  }
  const from = parseDmyOrIso(segments[0]);
  const to = parseDmyOrIso(segments[1]);
  if (!from || !to) {
    return { value: null, raw, confidence: 0.3, ...ref };
  }
  return { value: { from, to }, raw, confidence: 0.9, ...ref };
}

function parseDmyOrIso(s: string | undefined): string | null {
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

// Heuristic plan-code derivation. "Plan A: HJG 16+" → "PA";
// numeric-prefix labels ("1", "2") → "P1"; falls back to index.
function derivePlanCode(label: string, index: number): string {
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  if (planMatch) return `P${planMatch[1]?.toUpperCase()}`;
  const numMatch = label.match(/^(\d+)\b/);
  if (numMatch) return `P${numMatch[1]}`;
  return `P${index + 1}`;
}

// Sniff "additional above Plan X" → "X" (the rider-base hint that
// drives Plan.stacksOn). Same regex the parser uses, kept here so
// the extractor can re-derive it from raw plan text if needed.
function sniffStacksOnFromText(text: string): string | null {
  const m = text.match(/additional\s+above\s+Plan\s+([A-Z0-9]+)/i);
  return m?.[1] ?? null;
}

// Sniff multiplier "36 x LDBMS" → 36.
function sniffMultiplier(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*[x×]\s*(?:LDBMS|last\s*drawn|monthly\s*salary)/i);
  return m ? Number.parseInt(m[1] ?? '', 10) : null;
}

// Sniff fixed sum "$10,000" or "10000" — a numeric followed by no x.
function sniffFixedSum(text: string): number | null {
  const m = text.match(/\$?\s*([\d,]+)\b/);
  if (!m) return null;
  const n = Number.parseFloat((m[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function envelopePolicyEntity(e: ParsedPolicyEntity): PolicyEntityField {
  return {
    legalName: e.legalName,
    policyNumber: e.policyNumber || null,
    address: null,
    isMaster: e.isMaster,
    confidence: 0.95,
  };
}

// Parses a single ParsedProduct (from the heuristic parser) into the
// envelope shape. `policyEntities` is workbook-level metadata cloned
// onto every product so the wizard can read it from any extracted
// row without joining back to ParseResult.
function envelopeProduct(
  parsed: ParsedProduct,
  policyEntities: ParsedPolicyEntity[],
  productTypeStrategy: string | null,
  insurerCode: string,
  productTypeCode: string,
): ExtractedProduct {
  const fields = parsed.fields;
  const sheet = parsed.templateInsurerCode; // best proxy for sheet — actual cell coords live in parsingRules

  const headerSourceRef = (cellLabel: string): SourceRef => ({
    sheet,
    cell: cellLabel,
  });

  const periodRaw = fields.period_of_insurance;
  const policyNumberRaw =
    String(fields.policy_numbers_csv ?? fields.policy_number ?? '')
      .split(',')[0]
      ?.trim() ?? '';

  const coverBasis: PlanField['coverBasis'] =
    (productTypeStrategy ? COVER_BASIS_BY_STRATEGY[productTypeStrategy] : null) ?? 'fixed_amount';

  const plans: PlanField[] = parsed.plans.map((p, i) => {
    const label = String(p.code).trim();
    const code = derivePlanCode(label, i);
    const stacksOnFromHint = p.stacksOnLabel
      ? p.stacksOnLabel.replace(/^Plan\s+/i, '').trim()
      : sniffStacksOnFromText(label);
    // Schedule seed: only the multiplier / sumAssured are inferable
    // from the label. Tier-banded schedules need the schedule-of-
    // benefits sheet, which the broker fills via the Plans tab.
    const schedule: Record<string, unknown> = {};
    if (coverBasis === 'salary_multiple') {
      const mult = sniffMultiplier(label);
      if (mult != null) schedule.multiplier = mult;
    } else if (coverBasis === 'fixed_amount') {
      const sum = sniffFixedSum(label);
      if (sum != null) schedule.sumAssured = sum;
    }
    return {
      rawCode: label,
      rawName: label,
      code,
      name: label,
      coverBasis,
      stacksOnRawCode: stacksOnFromHint,
      selectionMode: 'broker_default',
      schedule,
      confidence: 0.9,
      sourceRef: headerSourceRef('plans-block'),
    };
  });

  // Premium rates — heuristic walks parsed.rates rows looking up
  // rate_column_map.{ratePerThousand|fixedAmount|tiers} via parsingRules.
  // We don't have the rules object on this side, so we surface the
  // raw rate rows tagged with their planMatch label; the extractor's
  // upstream caller wires column→tier via parsingRules.
  // For now, premium rates left empty here — extractor.ts populates
  // them after pulling parsingRules.rate_column_map.
  const premiumRates: PremiumRateField[] = [];

  return {
    productTypeCode,
    insurerCode,
    header: {
      policyNumber: stringField(policyNumberRaw, headerSourceRef('policy_numbers_csv')),
      period: parsePeriod(periodRaw, headerSourceRef('period_of_insurance')),
      lastEntryAge: numberField(
        Number.parseInt(String(fields.last_entry_age ?? '').match(/\d+/)?.[0] ?? '', 10),
        headerSourceRef('last_entry_age'),
      ),
      administrationType: stringField(fields.administration_type, headerSourceRef('administration_type')),
      currency: stringField('SGD', headerSourceRef('default-currency')),
    },
    policyholder: {
      legalName: stringField(fields.policyholder_name, headerSourceRef('policyholder_name')),
      uen: stringField(null),
      address: stringField(fields.address, headerSourceRef('address')),
      businessDescription: stringField(fields.business, headerSourceRef('business')),
      insuredEntities: policyEntities.map(envelopePolicyEntity),
    },
    eligibility: {
      freeText: stringField(fields.eligibility_text, headerSourceRef('eligibility_text')),
      categories: parsed.plans.map((p, i) => ({
        category: String(p.code).trim(),
        headcount: null,
        sumInsuredFormula: null,
        participation: null,
        confidence: 0.7,
        sourceRef: headerSourceRef(`plans-block-row-${i}`),
      })),
    },
    plans,
    premiumRates,
    benefits: [],
    extractionMeta: {
      overallConfidence: 0.85,
      extractorVersion: EXTRACTOR_VERSION,
      warnings: [],
    },
  };
}

export type CatalogueLookup = {
  productTypeStrategy: Record<string, string>; // productTypeCode → premiumStrategy
  parsingRules: Record<
    string,
    Record<string, ParsingRules>
  >; // productTypeCode → insurerCode → ParsingRules
};

export function envelopeFromParseResult(
  parseResult: ParseResult,
  catalogue: CatalogueLookup,
): ExtractedProduct[] {
  const policyEntities = parseResult.policyEntities ?? [];
  return parseResult.products.map((p) => {
    const strategy = catalogue.productTypeStrategy[p.productTypeCode] ?? null;
    const product = envelopeProduct(
      p,
      policyEntities,
      strategy,
      p.templateInsurerCode,
      p.productTypeCode,
    );
    // Now layer in premium rates, walking parsed.rates per the
    // rate_column_map for this (productType, insurer) pair.
    const rules = catalogue.parsingRules[p.productTypeCode]?.[p.templateInsurerCode];
    const map = rules?.rate_column_map;
    if (!map) return product;
    const planMatchKey = `col${excelColumnIndex(map.planMatch)}`;
    const rates: PremiumRateField[] = [];
    for (const row of p.rates) {
      const rawLabel = row[planMatchKey];
      if (!rawLabel) continue;
      const labelStr = String(rawLabel).trim();
      if (!labelStr) continue;
      const blockLabel = (row._blockLabel as string) ?? null;
      if (map.tiers && map.tiers.length > 0) {
        for (const t of map.tiers) {
          const cell = row[`col${excelColumnIndex(t.rateColumn)}`];
          const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
          if (!Number.isFinite(num) || num <= 0) continue;
          rates.push({
            planRawCode: labelStr,
            coverTier: t.tier,
            ratePerThousand: null,
            fixedAmount: num,
            blockLabel,
            ageBand: null,
            confidence: 0.95,
            sourceRef: { sheet: p.templateInsurerCode, cell: t.rateColumn },
          });
        }
      } else if (map.ratePerThousand) {
        const cell = row[`col${excelColumnIndex(map.ratePerThousand)}`];
        const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
        if (Number.isFinite(num) && num > 0) {
          rates.push({
            planRawCode: labelStr,
            coverTier: null,
            ratePerThousand: num,
            fixedAmount: null,
            blockLabel,
            ageBand: null,
            confidence: 0.95,
            sourceRef: { sheet: p.templateInsurerCode, cell: map.ratePerThousand },
          });
        }
      } else if (map.fixedAmount) {
        const cell = row[`col${excelColumnIndex(map.fixedAmount)}`];
        const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
        if (Number.isFinite(num) && num > 0) {
          rates.push({
            planRawCode: labelStr,
            coverTier: null,
            ratePerThousand: null,
            fixedAmount: num,
            blockLabel,
            ageBand: null,
            confidence: 0.95,
            sourceRef: { sheet: p.templateInsurerCode, cell: map.fixedAmount },
          });
        }
      }
    }
    return { ...product, premiumRates: rates };
  });
}
