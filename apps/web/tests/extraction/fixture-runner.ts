// =============================================================
// Heuristic fixture runner — runs the real extractor against a
// slip.xlsx without a live database by building a CatalogueLookup
// directly from the seeded PRODUCT_TYPE_SEEDS data.
//
// This powers Phase 2.7 of the extraction roadmap: the regression
// test calls runHeuristicFixture() instead of the stub, so fixture
// accuracy is measured against real heuristic output rather than
// an empty shell.
//
// Excluded from production bundle (tests/ tree, not src/).
// =============================================================

import type {
  CatalogueLookup,
  ExtractedProduct,
} from '../../src/server/extraction/heuristic-to-envelope';
import { envelopeFromParseResult } from '../../src/server/extraction/heuristic-to-envelope';
import { reconcile } from '../../src/server/extraction/reconciliation';
import { parsePlacementSlip } from '../../src/server/ingestion/parser';
import { PARSING_RULES_PER_PRODUCT, PRODUCT_TYPE_STRATEGIES } from './catalogue-data';

// Shape the regression test's compareToExpected() expects.
export type ActualExtraction = {
  proposedClient: unknown;
  proposedPolicyEntities: unknown[];
  proposedBenefitYear: unknown;
  proposedInsurers: unknown[];
  proposedPool: unknown;
  warnings: string[];
  extractedProducts: unknown[];
  reconciliation: unknown;
};

const DEFAULT_COUNTRY = 'SG';

const CATALOGUE: CatalogueLookup = {
  productTypeStrategy: { ...PRODUCT_TYPE_STRATEGIES },
  parsingRules: Object.fromEntries(
    PARSING_RULES_PER_PRODUCT.map(({ productTypeCode, rules }) => [productTypeCode, rules]),
  ),
};

// Synthesise the discovery-pass cross-cutting fields from heuristic
// ExtractedProduct[] — no AI needed. Uses first product as authority
// for slip-level metadata (policyholder, period) since all products
// on a single slip share the same client and benefit year.
function synthesiseCrossCutting(products: ExtractedProduct[]): {
  proposedClient: unknown;
  proposedPolicyEntities: unknown[];
  proposedBenefitYear: unknown;
  proposedInsurers: unknown[];
  proposedPool: unknown;
  warnings: string[];
} {
  if (products.length === 0) {
    return {
      proposedClient: null,
      proposedPolicyEntities: [],
      proposedBenefitYear: null,
      proposedInsurers: [],
      proposedPool: null,
      warnings: [],
    };
  }

  // products.length > 0 is guaranteed by the early return above.
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check
  const first = products[0]!;

  const proposedClient = {
    legalName: first.policyholder.legalName.value,
    tradingName: null,
    uen: first.policyholder.uen.value,
    countryOfIncorporation: DEFAULT_COUNTRY,
    address: first.policyholder.address.value,
    industry: null,
    primaryContactName: null,
    primaryContactEmail: null,
    confidence: first.policyholder.legalName.confidence,
  };

  // Collect all insured entities across products (de-duped by legalName).
  const entityMap = new Map<string, unknown>();
  for (const p of products) {
    for (const e of p.policyholder.insuredEntities) {
      const key = `${e.legalName}::${e.policyNumber ?? ''}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          legalName: e.legalName,
          policyNumber: e.policyNumber,
          address: e.address,
          siteCode: e.siteCode,
          headcountEstimate: e.headcountEstimate,
          isMaster: e.isMaster,
          confidence: e.confidence,
        });
      }
    }
  }
  // If no insured entities recorded, emit master entity from policyholder.
  const proposedPolicyEntities: unknown[] =
    entityMap.size > 0
      ? Array.from(entityMap.values())
      : [
          {
            legalName: first.policyholder.legalName.value ?? '',
            policyNumber: first.header.policyNumber.value,
            address: first.policyholder.address.value,
            siteCode: null,
            headcountEstimate: null,
            isMaster: true,
            confidence: first.policyholder.legalName.confidence,
          },
        ];

  const proposedBenefitYear = first.header.period.value
    ? {
        policyName: null,
        startDate: first.header.period.value.from,
        endDate: first.header.period.value.to,
        ageBasis: 'POLICY_START' as const,
        confidence: first.header.period.confidence,
      }
    : null;

  // One entry per unique insurer code.
  const insurerCounts = new Map<string, number>();
  for (const p of products) {
    insurerCounts.set(p.insurerCode, (insurerCounts.get(p.insurerCode) ?? 0) + 1);
  }
  const proposedInsurers = Array.from(insurerCounts.entries()).map(([code, count]) => ({
    code,
    rawLabel: code,
    productCount: count,
    confidence: 0.9,
  }));

  // Collect extraction warnings from all products.
  const warnings = products.flatMap((p) => p.extractionMeta.warnings);

  return {
    proposedClient,
    proposedPolicyEntities,
    proposedBenefitYear,
    proposedInsurers,
    proposedPool: null,
    warnings,
  };
}

// Run the heuristic extractor against a slip buffer.
// Returns ActualExtraction for use with compareToExpected().
export async function runHeuristicFixture(slipBuffer: Buffer): Promise<ActualExtraction> {
  const parseResult = await parsePlacementSlip(slipBuffer, PARSING_RULES_PER_PRODUCT);
  const extractedProducts = envelopeFromParseResult(parseResult, CATALOGUE);

  const crossCutting = synthesiseCrossCutting(extractedProducts);
  const reconciliation = reconcile(extractedProducts);

  return {
    ...crossCutting,
    extractedProducts,
    reconciliation,
  };
}
