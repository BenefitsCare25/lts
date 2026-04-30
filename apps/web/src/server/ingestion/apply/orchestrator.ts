// =============================================================
// Apply orchestrator — runs the full placement-slip → catalogue
// transaction. Composed from focused modules so the router can stay
// thin.
//
// Phase 1G scope:
//   ✅ PolicyEntity upsert from result.policyEntities
//   ✅ Product upsert per parsed product (insurer + policy_number)
//   ✅ Plan creation with placeholder schedule + stacksOn resolution
//   ✅ PremiumRate creation when parsingRules has a rate_column_map
//   ⏳ BenefitGroup: stays broker-confirmed in the review UI;
//      result.benefitGroups carries predicate suggestions only.
//
// Pre-resolution (insurer + productType + pool caches) happens
// outside the transaction so missing-FK diagnostics surface as
// skipped[] entries before any locks are taken.
// =============================================================

import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import type { ParseResult } from '@/server/ingestion/parser';
import type { Prisma } from '@prisma/client';
import { preResolveCatalogue } from './pre-resolve';
import { writePremiumRates } from './premium-rates';
import { writeProductsAndPlans } from './products-and-plans';

export type ApplySummary = {
  policyEntitiesUpserted: number;
  productsUpserted: number;
  plansCreated: number;
  stacksOnResolved: number;
  premiumRatesCreated: number;
  skipped: { reason: string; detail: string }[];
};

export async function applyParsedToCatalogue(args: {
  db: TenantDb;
  parseResult: ParseResult;
  uploadId: string;
  benefitYearId: string;
  // Already-loaded benefitYear with its policy. Caller verified
  // tenant scoping and DRAFT state.
  policyId: string;
}): Promise<{ summary: ApplySummary }> {
  const { db, parseResult, uploadId, benefitYearId, policyId } = args;

  // Stage 1 — pre-resolve catalogue refs outside the tx (Q4: batches
  // pool lookups so the previous N+1 inside the tx is now a single
  // findMany).
  const resolved = await preResolveCatalogue(db, parseResult);
  const skipped = resolved.skipped;

  // Stage 2 — atomic write. 60s timeout covers a worst-case
  // STM-class slip (7 products, ~30 plans, 60+ rate rows).
  const txResult = await prisma.$transaction(
    async (tx) => {
      let policyEntitiesUpserted = 0;

      // PolicyEntities — small, inlined for clarity.
      for (const entity of parseResult.policyEntities ?? []) {
        await tx.policyEntity.upsert({
          where: {
            policyId_policyNumber: {
              policyId,
              policyNumber: entity.policyNumber,
            },
          },
          update: {
            legalName: entity.legalName,
            isMaster: entity.isMaster,
          },
          create: {
            policyId,
            policyNumber: entity.policyNumber,
            legalName: entity.legalName,
            isMaster: entity.isMaster,
          },
        });
        policyEntitiesUpserted += 1;
      }

      const products = await writeProductsAndPlans(
        tx,
        benefitYearId,
        parseResult,
        resolved,
        skipped,
      );

      const rates = await writePremiumRates(
        tx,
        parseResult,
        resolved,
        products.productHandles,
        skipped,
      );

      if ((parseResult.benefitGroups?.length ?? 0) > 0) {
        skipped.push({
          reason: 'BENEFIT_GROUPS_DEFERRED',
          detail: `${parseResult.benefitGroups.length} predicate suggestions surfaced — confirm in the Benefit Groups screen, not auto-saved.`,
        });
      }

      await tx.placementSlipUpload.update({
        where: { id: uploadId },
        data: { parseStatus: 'APPLIED' },
      });

      return {
        policyEntitiesUpserted,
        productsUpserted: products.productsUpserted,
        plansCreated: products.plansCreated,
        stacksOnResolved: products.stacksOnResolved,
        premiumRatesCreated: rates.premiumRatesCreated,
      };
    },
    { maxWait: 5_000, timeout: 60_000 },
  );

  return {
    summary: {
      policyEntitiesUpserted: txResult.policyEntitiesUpserted,
      productsUpserted: txResult.productsUpserted,
      plansCreated: txResult.plansCreated,
      stacksOnResolved: txResult.stacksOnResolved,
      premiumRatesCreated: txResult.premiumRatesCreated,
      skipped,
    },
  };
}

// Re-exports so the router can import from one path.
export type { Prisma };
