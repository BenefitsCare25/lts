// =============================================================
// AI extraction output schema.
//
// Bundles the canonical per-product envelope (extracted-product.json)
// with the wizard-section-level proposals (client, policy entities,
// benefit year, insurers, pool) into one tool-input schema. The model
// emits one object that fills every fillable corner of the wizard.
//
// The schema is hand-assembled (rather than `$ref`-ing the existing
// extracted-product.json) because Anthropic's tool-use endpoint does
// not resolve external `$ref`s — the entire schema must be inlined.
// We import the JSON file at build time and embed it under
// `properties.products.items` so we have one source of truth.
//
// Ajv-compiled validators are exported as singletons; the runner
// uses them to enforce the contract on every model response and
// to drive a one-shot retry on validation failure.
// =============================================================

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import extractedProductSchema from '../../../../../../packages/catalogue-schemas/extracted-product.json';

// Single Ajv instance — compile is expensive, the singleton means
// the validator survives across extraction calls.
//
// extracted-product.json declares draft-7 ($schema header), so the
// default Ajv constructor is correct here. `strict: false` matches
// the rest of the project's catalogue Ajv usage and tolerates the
// `additionalProperties: false` + `enum: [..., null]` mix the
// proposed.* extensions use.
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: false,
  strict: false,
});
addFormats(ajv);

// Standalone schema for the per-product envelope. We re-export so
// the merger / wizard read paths can validate previously-stored
// drafts on read if they want to.
export const productSchema = extractedProductSchema as Record<string, unknown>;

// SourceRef is reused by every proposed.* block. Inline so the tool
// schema stays self-contained.
const sourceRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sheet: { type: 'string' },
    cell: { type: 'string' },
    range: { type: 'string' },
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
          'Insurer.code from the catalogue insurers list. Use the closest match; if no match exists, propose a new code in UPPER_SNAKE form.',
      },
      rawLabel: { type: 'string', description: 'Verbatim insurer label as it appears on the slip.' },
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

// The full tool input schema the model must populate. `products` re-
// uses extracted-product.json verbatim so per-product fields stay in
// lock-step with the rest of the system.
export const aiOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'products',
    'proposedClient',
    'proposedPolicyEntities',
    'proposedBenefitYear',
    'proposedInsurers',
    'warnings',
  ],
  properties: {
    products: {
      type: 'array',
      items: productSchema,
    },
    proposedClient: proposedClientSchema,
    proposedPolicyEntities: proposedPolicyEntitiesSchema,
    proposedBenefitYear: proposedBenefitYearSchema,
    proposedInsurers: proposedInsurersSchema,
    proposedPool: proposedPoolSchema,
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Any caveats the broker should see — e.g. "Plan B and C have identical names but different rates", "Currency missing from sheet GTL".',
    },
  },
} as const;

// Compiled validator. Singleton because Ajv compilation is the
// expensive part; re-use across every extraction call.
let _validator: ValidateFunction | null = null;
export function getOutputValidator(): ValidateFunction {
  if (!_validator) {
    _validator = ajv.compile(aiOutputSchema);
  }
  return _validator;
}

export type AiOutputProposedClient = {
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

export type AiOutputPolicyEntity = {
  legalName: string;
  policyNumber: string | null;
  address: string | null;
  headcountEstimate: number | null;
  isMaster: boolean;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
};

export type AiOutputBenefitYear = {
  policyName: string | null;
  startDate: string | null;
  endDate: string | null;
  ageBasis: 'POLICY_START' | 'HIRE_DATE' | 'AS_AT_EVENT' | null;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
};

export type AiOutputInsurer = {
  code: string;
  rawLabel: string;
  productCount: number;
  confidence: number;
};

export type AiOutputPool = {
  name: string | null;
  poolId: string | null;
  rawLabel: string | null;
  confidence: number;
  sourceRef?: { sheet?: string; cell?: string; range?: string };
} | null;

export type AiOutput = {
  products: unknown[]; // typed as ExtractedProduct[] downstream after Ajv passes
  proposedClient: AiOutputProposedClient;
  proposedPolicyEntities: AiOutputPolicyEntity[];
  proposedBenefitYear: AiOutputBenefitYear;
  proposedInsurers: AiOutputInsurer[];
  proposedPool: AiOutputPool;
  warnings: string[];
};

// Stringifies Ajv errors into a compact format the model can read on
// retry. We keep it short — the model just needs to know where to
// look, not see the entire error chain.
export function formatAjvErrors(errors: ValidateFunction['errors']): string {
  if (!errors || errors.length === 0) return '(no error details)';
  return errors
    .slice(0, 12) // cap so we don't overflow the retry prompt
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
    .join('\n');
}
