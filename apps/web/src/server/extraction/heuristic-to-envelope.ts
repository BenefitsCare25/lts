// =============================================================
// Heuristic → ExtractedProduct[] envelope.
//
// Turns the deterministic parser's output into the shape declared
// by packages/catalogue-schemas/extracted-product.json. Every leaf
// becomes a {value, raw, confidence, sourceRef} envelope so the
// wizard can render confidence chips and source-cell hovers without
// caring whether the LLM stage ever ran.
//
// This file is a re-export barrel — implementation lives in ./envelope/.
// =============================================================

export type {
  BenefitField,
  CatalogueLookup,
  CategoryField,
  ExtractedProduct,
  FieldEnvelope,
  NumberField,
  PeriodField,
  PlanField,
  PolicyEntityField,
  PremiumRateField,
  SourceRef,
  StringField,
} from './envelope/types';

export { parseScheduleFromFormula } from './envelope/plans';
export { envelopeFromParseResult } from './envelope/assemble';
