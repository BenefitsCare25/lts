// =============================================================
// AUTO-GENERATED — do not edit by hand.
// Source: packages/catalogue-schemas/extracted-product.json
// Regenerate: pnpm schemas:generate
// =============================================================

import { z } from 'zod';

export const extractedProductSchema = z
  .object({
    productTypeCode: z.string().describe('Catalogue ProductType.code, e.g. GTL, GHS, GPA'),
    insurerCode: z.string().describe('Insurer.code, e.g. GE_LIFE, TM_LIFE, ZURICH'),
    bundledWithProductCode: z
      .union([
        z
          .string()
          .describe(
            "When this product's premium is rolled into another product's rates (e.g. SP rates listed as 'Part of GHS'). The reconciliation skips this product; the wizard's Rates tab shows a 'bundled' notice.",
          ),
        z
          .null()
          .describe(
            "When this product's premium is rolled into another product's rates (e.g. SP rates listed as 'Part of GHS'). The reconciliation skips this product; the wizard's Rates tab shows a 'bundled' notice.",
          ),
      ])
      .describe(
        "When this product's premium is rolled into another product's rates (e.g. SP rates listed as 'Part of GHS'). The reconciliation skips this product; the wizard's Rates tab shows a 'bundled' notice.",
      )
      .optional(),
    header: z
      .object({
        policyNumber: z.any(),
        period: z.any(),
        lastEntryAge: z.any().optional(),
        administrationType: z.any().optional(),
        currency: z.any().optional(),
        declaredPremium: z.any().optional(),
        nonEvidenceLimit: z.any().optional(),
      })
      .strict(),
    policyholder: z
      .object({
        legalName: z.any(),
        uen: z.any().optional(),
        address: z.any().optional(),
        businessDescription: z.any().optional(),
        insuredEntities: z.array(z.any()).optional(),
      })
      .strict(),
    eligibility: z
      .object({
        freeText: z.any().optional(),
        categories: z
          .array(z.any())
          .describe('Basis-of-cover rows: employee categories with headcounts and SI basis')
          .optional(),
      })
      .strict(),
    plans: z.array(z.any()),
    premiumRates: z.array(z.any()),
    benefits: z.array(z.any()),
    extractionMeta: z
      .object({
        overallConfidence: z.number().gte(0).lte(1).optional(),
        extractorVersion: z.string().optional(),
        envelopeVersion: z
          .string()
          .describe(
            "Schema version written by the runner. 'v2' for envelopes produced after the Phase 1 migration.",
          )
          .optional(),
        warnings: z.array(z.string()).optional(),
      })
      .describe(
        'Optional metadata block. The runner overrides this with canonical values after the AI call (overallConfidence aggregated from envelopes, extractorVersion = AI_EXTRACTOR_VERSION constant), so the model is not required to populate it.',
      )
      .optional(),
  })
  .strict()
  .describe(
    'AI-extracted placement-slip data for one (ProductType x Insurer) instance. Every field carries provenance + confidence so the review UI can highlight uncertainty.',
  );
export type ExtractedProductSchema = z.infer<typeof extractedProductSchema>;
