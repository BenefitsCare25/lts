// Final envelope assembly — builds ExtractedProduct[] from ParseResult.
// Orchestrates field constructors, plan builder, and rate mapper.

import type { ParseResult, ParsedPolicyEntity, ParsedProduct } from '@/server/ingestion/parser';
import {
  looksLikePlaceholder,
  numberField,
  parsePeriod,
  policyNumberField,
  stringField,
} from './fields';
import { buildPlans } from './plans';
import { buildRates } from './rates';
import type {
  CatalogueLookup,
  ExtractedProduct,
  PolicyEntityField,
  PremiumRateField,
  SourceRef,
} from './types';

const EXTRACTOR_VERSION = 'heuristic-1.0';

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

// Parses a single ParsedProduct into the envelope shape.
// `policyEntities` is workbook-level metadata cloned onto every product so
// the wizard can read it from any extracted row without joining back to ParseResult.
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

  const plans = buildPlans(parsed, productTypeStrategy, headerSourceRef);

  // Premium rates left empty here — layered in by envelopeFromParseResult
  // once it has access to parsingRules.rate_column_map.
  const premiumRates: PremiumRateField[] = [];

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
      // 0.3 lets the AI override cleanly.
      categories: parsed.plans.map((p, i) => ({
        category: String(p.code).trim(),
        headcount: null,
        sumInsuredFormula: null,
        participation: null,
        defaultPlanRawCode: String(p.code).trim() || null,
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

    // Layer in premium rates, walking parsed.rates per the
    // rate_column_map for this (productType, insurer) pair.
    const rules = catalogue.parsingRules[p.productTypeCode]?.[p.templateInsurerCode];
    const map = rules?.rate_column_map;
    if (!map) return product;

    return { ...product, premiumRates: buildRates(p, map) };
  });
}
