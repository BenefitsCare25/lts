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

import { type CoverBasis, COVER_BASIS_BY_STRATEGY, excelColumnIndex } from '@/server/catalogue/premium-strategy';
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
  siteCode: string | null;
  headcountEstimate: number | null;
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
  coverBasis: CoverBasis;
  /** @deprecated use stacksOnRawCodes (array) */
  stacksOnRawCode: string | null;
  stacksOnRawCodes: string[];
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
  bundledWithProductCode?: string | null;
  header: {
    policyNumber: StringField;
    period: PeriodField;
    lastEntryAge: NumberField;
    administrationType: StringField;
    currency: StringField;
    declaredPremium?: NumberField;
    nonEvidenceLimit?: StringField;
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

// Detect placeholder values commonly used in placement slips when a
// number isn't yet assigned (e.g. "TBA", "TBC", "Pending", "N/A").
// Returns true when the trimmed string is one of those — the caller
// should treat the field as null rather than persisting the literal
// placeholder, which would otherwise flow into Apply as a fake policy
// number / UEN / value and trip downstream uniqueness or format checks.
const POLICY_NUMBER_PLACEHOLDER_RE = /^(?:tba|tbc|tbd|pending|n\.?\s*a\.?|n\/a|nil|none|-+)$/i;
const looksLikePlaceholder = (s: string): boolean => POLICY_NUMBER_PLACEHOLDER_RE.test(s.trim());

// Like `stringField` but treats placeholder strings (TBA, TBC, pending,
// N/A, etc.) as null with confidence 0 — preserving the original raw
// value so the wizard can show "captured but unassigned" hints.
const policyNumberField = (raw: unknown, sourceRef?: SourceRef): StringField => {
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
  // Parse failure: confidence 0 (not 0.3) so the wizard treats this
  // exactly like "field absent" rather than "low-confidence value
  // present" — the latter mis-styles the form input as if it has data.
  // The original raw text stays in `raw` so the AI runner and the
  // source-ref hover still see what was on the slip.
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

// Heuristic plan-code derivation. Order:
//   "Plan A: HJG 16+"   → "PA"
//   "1.5"               → "P1_5"  (numeric, decimal preserved)
//   "Executive Plus"    → "PEXECPL" (first 6 alnum chars after P-prefix)
//   "—" / unicode-only  → `P_${index+1}` (last-resort fallback)
//
// Why deterministic-from-label beats index-based: re-uploading the
// same slip with reordered sheets must produce stable plan codes.
// The previous `P${index + 1}` fallback rotated codes when sheet
// order shifted, breaking downstream rate matching.
function derivePlanCode(label: string, index: number): string {
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  if (planMatch) return `P${planMatch[1]?.toUpperCase()}`;
  const numMatch = label.match(/^(\d+(?:[.,]\d+)?)\b/);
  if (numMatch) {
    const normalized = numMatch[1]?.replace(/[.,]/g, '_');
    return `P${normalized}`;
  }
  // Strip non-ASCII-alphanumeric, take first 6 chars as the slug.
  const slug = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6);
  if (slug.length > 0) return `P${slug}`;
  return `P_${index + 1}`;
}

// Sniff "additional above Plan X" or "additional above Plan X / Plan Y"
// → ["X"] or ["X","Y"]. Returns empty array when no stacking found.
function sniffStacksOnFromText(text: string): string[] {
  const normalised = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  // "additional above Plan A / Plan B" or "additional above Plan A and Plan B"
  const multiM = normalised.match(
    /additional\s+above\s+Plan\s+([A-Z0-9]+)\s*(?:\/|and)\s*Plan\s+([A-Z0-9]+)/i,
  );
  if (multiM) return [(multiM[1] ?? '').toUpperCase(), (multiM[2] ?? '').toUpperCase()];
  const singleM = normalised.match(/additional\s+above\s+Plan\s+([A-Z0-9]+)/i);
  if (singleM) return [(singleM[1] ?? '').toUpperCase()];
  return [];
}

type PlanScheduleResult = {
  basis: PlanField['coverBasis'];
  schedule: Partial<{
    multiplier: number;
    sumAssured: number;
    ratePerEmployee: number;
  }>;
};

// Comprehensive schedule pattern matching (item 2.1).
// Order matters: more-specific patterns first to avoid false positives.
export function parseScheduleFromFormula(formula: string | null): PlanScheduleResult | null {
  if (!formula) return null;
  const cleaned = formula.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Salary multiple: "36 x LDBMS", "36×Last Drawn Basic Monthly Salary"
  const multM = cleaned.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(?:LDBMS|last\s+drawn|monthly\s+salary|basic\s+monthly)/i,
  );
  if (multM) {
    const value = Number.parseFloat(multM[1] ?? '');
    if (Number.isFinite(value))
      return { basis: 'salary_multiple', schedule: { multiplier: value } };
  }

  // Per-employee flat rate: "$9.50 per insured person", "9.5 per life"
  const perEmpM = cleaned.match(
    /S?\$?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s+)?(?:insured|employee|person|life|head|pax)/i,
  );
  if (perEmpM) {
    const value = Number.parseFloat((perEmpM[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value))
      return { basis: 'per_employee_flat', schedule: { ratePerEmployee: value } };
  }

  // Fixed sum assured: "$50,000" or "S$50,000" or bare "50000"
  const fixedM = cleaned.match(/^S?\$?\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (fixedM) {
    const value = Number.parseFloat((fixedM[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value)) return { basis: 'fixed_amount', schedule: { sumAssured: value } };
  }

  return null;
}

// Site-code sniff: a non-master entity address that looks like a short
// location code (≤6 uppercase/digit chars, no spaces, not a postal code).
// Examples: "AMK", "TPY", "HQ", "JTC-AW". Full Singapore postal codes
// are 6 digits — excluded so we don't misclassify them.
function sniffSiteCode(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (/^\d{6}$/.test(trimmed)) return null; // postal code
  if (/^[A-Z0-9][A-Z0-9\-]{0,5}$/.test(trimmed)) return trimmed;
  return null;
}

function envelopePolicyEntity(e: ParsedPolicyEntity): PolicyEntityField {
  // ParsedPolicyEntity doesn't carry an address field from the heuristic
  // parser; the AI pass fills it in. Heuristic confidence stays 0.95 for
  // the structural fields we do have.
  return {
    legalName: e.legalName,
    policyNumber: e.policyNumber || null,
    address: null,
    siteCode: null,
    headcountEstimate: null,
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

    // Multi-parent stacking: prefer explicit parser hint, then sniff from label.
    const stacksOnRawCodes: string[] = p.stacksOnLabel
      ? [
          p.stacksOnLabel
            .replace(/^Plan\s+/i, '')
            .trim()
            .toUpperCase(),
        ]
      : sniffStacksOnFromText(label);

    // Schedule: try the comprehensive formula parser first (works on the
    // full label text), then fall back to the product-level coverBasis.
    const scheduleResult = parseScheduleFromFormula(label);
    let effectiveCoverBasis = coverBasis;
    let schedule: Record<string, unknown> = {};
    if (scheduleResult) {
      effectiveCoverBasis = scheduleResult.basis;
      schedule = scheduleResult.schedule;
    }

    return {
      rawCode: label,
      rawName: label,
      code,
      name: label,
      coverBasis: effectiveCoverBasis,
      stacksOnRawCode: stacksOnRawCodes[0] ?? null, // deprecated singular
      stacksOnRawCodes,
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

  // Per-product warnings for the extraction meta. Surfacing TBA-style
  // policy-number placeholders here lets the wizard's banner remind
  // brokers the slip didn't carry a real value yet.
  const productWarnings: string[] = [];
  if (policyNumberRaw && looksLikePlaceholder(policyNumberRaw)) {
    productWarnings.push(
      `${productTypeCode} (${insurerCode}): policy number on the slip is "${policyNumberRaw.trim()}" — broker must fill before apply.`,
    );
  }

  return {
    productTypeCode,
    insurerCode,
    header: {
      policyNumber: policyNumberField(policyNumberRaw, headerSourceRef('policy_numbers_csv')),
      period: parsePeriod(periodRaw, headerSourceRef('period_of_insurance')),
      lastEntryAge: numberField(
        Number.parseInt(String(fields.last_entry_age ?? '').match(/\d+/)?.[0] ?? '', 10),
        headerSourceRef('last_entry_age'),
      ),
      administrationType: stringField(
        fields.administration_type,
        headerSourceRef('administration_type'),
      ),
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
      // Confidence 0.3: the heuristic only knows the plan label;
      // headcount, sumInsuredFormula, and participation are all null.
      // Prior 0.7 over-promised — pick.confidence comparisons in the
      // AI merger would discard a richer AI category in favour of this
      // empty placeholder. 0.3 lets the AI override cleanly.
      categories: parsed.plans.map((p, i) => ({
        category: String(p.code).trim(),
        headcount: null,
        sumInsuredFormula: null,
        participation: null,
        confidence: 0.3,
        sourceRef: headerSourceRef(`plans-block-row-${i}`),
      })),
    },
    plans,
    premiumRates,
    benefits: [],
    extractionMeta: {
      overallConfidence: 0.85,
      extractorVersion: EXTRACTOR_VERSION,
      warnings: productWarnings,
    },
  };
}

// Extract business description from the first product that has it (EX-7).
// Placement slips carry "Business: <text>" on every product sheet but
// it's the same for the whole workbook — take the first non-empty value.
function extractBusinessDescription(parseResult: ParseResult): string | null {
  for (const product of parseResult.products) {
    const desc = product.fields.business_description ?? product.fields.business;
    if (typeof desc === 'string' && desc.trim().length > 0) return desc.trim();
  }
  return null;
}

export type CatalogueLookup = {
  productTypeStrategy: Record<string, string>; // productTypeCode → premiumStrategy
  parsingRules: Record<string, Record<string, ParsingRules>>; // productTypeCode → insurerCode → ParsingRules
};

export function envelopeFromParseResult(
  parseResult: ParseResult,
  catalogue: CatalogueLookup,
): ExtractedProduct[] {
  const policyEntities = parseResult.policyEntities ?? [];
  const businessDesc = extractBusinessDescription(parseResult);

  return parseResult.products.map((p) => {
    const strategy = catalogue.productTypeStrategy[p.productTypeCode] ?? null;
    const product = envelopeProduct(
      p,
      policyEntities,
      strategy,
      p.templateInsurerCode,
      p.productTypeCode,
    );

    // Overlay workbook-level businessDescription onto every product (EX-7).
    if (businessDesc && product.policyholder.businessDescription.value === null) {
      product.policyholder.businessDescription = stringField(businessDesc);
    }

    // Sniff siteCode for non-master entities whose "address" looks like a
    // short site code rather than a registered address (V-5).
    product.policyholder.insuredEntities = product.policyholder.insuredEntities.map((e) => {
      if (e.isMaster) return e;
      const code = sniffSiteCode(e.address);
      if (!code) return e;
      return { ...e, address: null, siteCode: code };
    });
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
