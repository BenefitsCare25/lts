// =============================================================
// Discovery-pass output schema.
//
// Stage 1 of the map-reduce extraction: the model returns the
// product manifest (which products are present, where to find them)
// plus the cross-cutting metadata (client, entities, benefit year,
// insurers, pool). It does NOT return per-product field-level data —
// that comes back from the Stage 2 per-product passes.
//
// Why a separate schema: the per-product envelope is heavy (every
// leaf wrapped in {value, raw, confidence, sourceRef}). Asking the
// model for that AND the full envelope for N products in one call
// is what blew the v1 budget. Discovery output stays under ~3-5K
// tokens regardless of how many products are present.
//
// The cross-cutting fields use lightweight `{ value | null,
// confidence }` shapes (not the full envelope) — the wizard surfaces
// these as draft suggestions the broker confirms, so sourceRef on
// e.g. proposedClient.legalName is nice-to-have, not required.
// =============================================================

import { type ValidateFunction, formatAjvError, safeCompile } from '@/server/catalogue/ajv';

// Inline because Anthropic's tool-use endpoint does not resolve
// external $refs — the schema sent to the model must be self-
// contained.
const sourceRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sheet: { type: 'string' },
    cell: { type: 'string' },
    range: { type: 'string' },
  },
} as const;

const productManifestEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productTypeCode', 'insurerCode', 'anchorSheets', 'confidence'],
  properties: {
    productTypeCode: {
      type: 'string',
      description: 'ProductType.code from the catalogue. MUST match the catalogue snapshot.',
    },
    insurerCode: {
      type: 'string',
      description:
        'Insurer.code from the catalogue, OR a proposed UPPER_SNAKE code if the insurer is new.',
    },
    anchorSheets: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Sheet names (case-sensitive, as they appear in the workbook serialization) where this ' +
        "product's data lives. Used by the per-product extraction pass to focus its attention.",
    },
    notes: {
      type: ['string', 'null'],
      description:
        'Optional one-line note about anything unusual the per-product pass should know ' +
        '(e.g. "rates split across two adjacent sheets", "stacks on Plan A").',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

const proposedClientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['confidence'],
  properties: {
    legalName: { type: ['string', 'null'] },
    tradingName: { type: ['string', 'null'] },
    uen: { type: ['string', 'null'] },
    countryOfIncorporation: {
      type: ['string', 'null'],
      description: 'ISO-3166 alpha-2 code from the catalogue countries list (e.g. SG, MY, US).',
    },
    address: { type: ['string', 'null'] },
    industry: {
      type: ['string', 'null'],
      description: 'SSIC code from the catalogue industries list. Null if no confident match.',
    },
    primaryContactName: { type: ['string', 'null'] },
    primaryContactEmail: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceRef: sourceRefSchema,
  },
} as const;

const proposedPolicyEntitiesSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['legalName', 'isMaster', 'confidence'],
    properties: {
      legalName: { type: 'string' },
      policyNumber: { type: ['string', 'null'] },
      address: { type: ['string', 'null'] },
      siteCode: {
        type: ['string', 'null'],
        description: 'Short branch/site code (e.g. AMK, TPY, HQ) when the slip only provides a code rather than a full registered address.',
      },
      headcountEstimate: { type: ['integer', 'null'], minimum: 0 },
      isMaster: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      sourceRef: sourceRefSchema,
    },
  },
} as const;

const proposedBenefitYearSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['confidence'],
  properties: {
    policyName: { type: ['string', 'null'] },
    startDate: {
      type: ['string', 'null'],
      description: 'ISO date (yyyy-mm-dd). Null if not detectable.',
    },
    endDate: { type: ['string', 'null'] },
    ageBasis: {
      type: ['string', 'null'],
      enum: ['POLICY_START', 'HIRE_DATE', 'AS_AT_EVENT', null],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceRef: sourceRefSchema,
  },
} as const;

const proposedInsurersSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'rawLabel', 'productCount', 'confidence'],
    properties: {
      code: {
        type: 'string',
        description:
          'Insurer.code from the catalogue insurers list, or a proposed UPPER_SNAKE code.',
      },
      rawLabel: {
        type: 'string',
        description: 'Verbatim insurer label as it appears on the slip.',
      },
      productCount: { type: 'integer', minimum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
} as const;

const proposedPoolSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    name: { type: ['string', 'null'] },
    poolId: {
      type: ['string', 'null'],
      description: 'Pool.id from the catalogue pools list, or null if no match.',
    },
    rawLabel: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceRef: sourceRefSchema,
  },
} as const;

export const discoveryOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productManifest',
    'proposedClient',
    'proposedPolicyEntities',
    'proposedBenefitYear',
    'proposedInsurers',
    'warnings',
  ],
  properties: {
    productManifest: {
      type: 'array',
      items: productManifestEntrySchema,
      description:
        'One entry per distinct (product type, insurer) combination present in the workbook. ' +
        'STM-style slips with four insurers covering GHS each => four GHS entries.',
    },
    proposedClient: proposedClientSchema,
    proposedPolicyEntities: proposedPolicyEntitiesSchema,
    proposedBenefitYear: proposedBenefitYearSchema,
    proposedInsurers: proposedInsurersSchema,
    proposedPool: proposedPoolSchema,
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Caveats: contradictions between sheets, missing data, illegible cells, etc.',
    },
  },
} as const;

export function getDiscoveryValidator(): ValidateFunction {
  const result = safeCompile(discoveryOutputSchema, 'extraction:discovery-v1');
  if (!result.ok) {
    throw new Error(`Discovery schema failed to compile: ${result.error}`);
  }
  return result.validate;
}

export type ProductManifestEntry = {
  productTypeCode: string;
  insurerCode: string;
  anchorSheets: string[];
  notes?: string | null;
  confidence: number;
};

export type DiscoveryProposedClient = {
  legalName: string | null;
  tradingName: string | null;
  uen: string | null;
  countryOfIncorporation: string | null;
  address: string | null;
  industry: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
};

export type DiscoveryPolicyEntity = {
  legalName: string;
  policyNumber: string | null;
  address: string | null;
  headcountEstimate: number | null;
  isMaster: boolean;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
};

export type DiscoveryBenefitYear = {
  policyName: string | null;
  startDate: string | null;
  endDate: string | null;
  ageBasis: 'POLICY_START' | 'HIRE_DATE' | 'AS_AT_EVENT' | null;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
};

export type DiscoveryInsurer = {
  code: string;
  rawLabel: string;
  productCount: number;
  confidence: number;
};

export type DiscoveryPool = {
  name: string | null;
  poolId: string | null;
  rawLabel: string | null;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
} | null;

export type DiscoveryOutput = {
  productManifest: ProductManifestEntry[];
  proposedClient: DiscoveryProposedClient;
  proposedPolicyEntities: DiscoveryPolicyEntity[];
  proposedBenefitYear: DiscoveryBenefitYear;
  proposedInsurers: DiscoveryInsurer[];
  proposedPool: DiscoveryPool;
  warnings: string[];
};

export function formatDiscoveryAjvErrors(errors: ValidateFunction['errors']): string {
  if (!errors || errors.length === 0) return '(no error details)';
  return errors.slice(0, 12).map(formatAjvError).join('\n');
}

export const DISCOVERY_TOOL_NAME = 'emit_discovery';

export const DISCOVERY_TOOL_DESCRIPTION =
  'Emit the discovery result for the placement slip workbook: which products are present ' +
  '(productManifest) and the cross-cutting metadata (client, policy entities, benefit year, ' +
  'insurers, pool). Do NOT extract per-product fields — that is a separate pass. ' +
  'Always return arrays even when empty.';
