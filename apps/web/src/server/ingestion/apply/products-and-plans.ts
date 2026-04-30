// =============================================================
// Products + Plans (+ stacksOn) writer for placement-slip apply.
//
// Runs inside the apply transaction. Idempotent: upserts on the
// natural keys (benefitYearId + productTypeId for Product, productId
// + code for Plan) so re-applying the same slip doesn't dup rows.
//
// Plan codes are derived from the parsed plan label:
//   "Plan A something" → "PA"
//   "1 something"      → "P1"
//   fallback           → "P<index+1>"
// =============================================================

import { safeCompile } from '@/server/catalogue/ajv';
import { COVER_BASIS_BY_STRATEGY } from '@/server/catalogue/premium-strategy';
import type { ParseResult } from '@/server/ingestion/parser';
import type { Prisma } from '@prisma/client';
import type { PreResolvedCatalogue, SkippedEntry } from './pre-resolve';

export type ProductsAndPlansResult = {
  productsUpserted: number;
  plansCreated: number;
  stacksOnResolved: number;
  // Per-product context the premium-rates pass needs.
  productHandles: ProductHandle[];
};

export type ProductHandle = {
  productId: string;
  productTypeCode: string;
  templateInsurerCode: string;
};

function deriveCode(label: string, index: number): string {
  const planMatch = label.match(/^Plan\s+([A-Z0-9]+)/i);
  const numberMatch = label.match(/^(\d+)\b/);
  if (planMatch) return `P${planMatch[1]?.toUpperCase()}`;
  if (numberMatch) return `P${numberMatch[1]}`;
  return `P${index + 1}`;
}

export async function writeProductsAndPlans(
  tx: Prisma.TransactionClient,
  benefitYearId: string,
  parseResult: ParseResult,
  resolved: PreResolvedCatalogue,
  skipped: SkippedEntry[],
): Promise<ProductsAndPlansResult> {
  let productsUpserted = 0;
  let plansCreated = 0;
  let stacksOnResolved = 0;
  const productHandles: ProductHandle[] = [];

  for (const parsed of parseResult.products) {
    const insurerId = resolved.insurerCache.get(parsed.templateInsurerCode);
    const productType = resolved.productTypeCache.get(parsed.productTypeCode);
    if (!insurerId || !productType) continue; // surfaced in skipped[] by pre-resolve

    // Pool resolution — pre-batched in pre-resolve. Sentinel values
    // (NA / N.A / empty) collapse to null.
    const poolName = String(parsed.fields.pool_name ?? '').trim();
    const poolId = poolName ? (resolved.poolCache.get(poolName) ?? null) : null;

    // Product.data: minimum viable shape that passes ProductType.schema.
    // Real fields fill in from parsed.fields where keys align.
    const policyNumber =
      String(parsed.fields.policy_numbers_csv ?? parsed.fields.policy_number ?? '')
        .split(',')[0]
        ?.trim() ?? '';
    const productData: Record<string, unknown> = {
      insurer: parsed.templateInsurerCode,
      policy_number: policyNumber || 'PENDING',
      eligibility_text: parsed.fields.eligibility_text ?? undefined,
      benefit_period: parsed.fields.period_of_insurance ?? undefined,
    };

    // Upsert Product on (benefitYearId, productTypeId).
    const existing = await tx.product.findFirst({
      where: { benefitYearId, productTypeId: productType.id },
      select: { id: true },
    });
    const product = existing
      ? await tx.product.update({
          where: { id: existing.id },
          data: { insurerId, poolId, data: productData as Prisma.InputJsonValue },
        })
      : await tx.product.create({
          data: {
            benefitYearId,
            productTypeId: productType.id,
            insurerId,
            poolId,
            data: productData as Prisma.InputJsonValue,
          },
        });
    productsUpserted += 1;
    productHandles.push({
      productId: product.id,
      productTypeCode: parsed.productTypeCode,
      templateInsurerCode: parsed.templateInsurerCode,
    });

    // Validate plan schedule against planSchema (compile once per
    // productType — Ajv's safeCompile already caches by key).
    const compiled = safeCompile(
      productType.planSchema,
      `product-type:${productType.id}::planSchema-applyToCatalogue`,
    );
    const coverBasis = COVER_BASIS_BY_STRATEGY[productType.premiumStrategy] ?? 'fixed_amount';

    // First pass — create/update plans, surface schema violations.
    const labelToCode = new Map<string, string>();
    for (let i = 0; i < parsed.plans.length; i++) {
      const plan = parsed.plans[i];
      if (!plan) continue;
      const code = deriveCode(plan.code, i);
      labelToCode.set(plan.code, code);

      if (compiled.ok) {
        const candidate = {
          code,
          name: plan.code,
          coverBasis,
          stacksOn: null,
          selectionMode: 'single',
          schedule: {},
          effectiveFrom: null,
          effectiveTo: null,
        };
        if (!compiled.validate(candidate)) {
          const fields = (compiled.validate.errors ?? [])
            .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
            .filter((m) => m.length > 0)
            .slice(0, 5)
            .join(', ');
          skipped.push({
            reason: 'PLAN_SCHEDULE_NEEDS_BROKER_INPUT',
            detail: `${parsed.productTypeCode} plan ${code}: required fields not on the slip — fill in via the Plans tab before publishing (${fields}).`,
          });
        }
      }

      await tx.plan.upsert({
        where: { productId_code: { productId: product.id, code } },
        update: { name: plan.code, coverBasis },
        create: {
          productId: product.id,
          code,
          name: plan.code,
          coverBasis,
          schedule: {} as Prisma.InputJsonValue,
        },
      });
      plansCreated += 1;
    }

    // Second pass — resolve stacksOn now that all plans exist.
    for (const plan of parsed.plans) {
      if (!plan.stacksOnLabel) continue;
      const baseLabelMatch = parsed.plans.find((p) =>
        p.code.toLowerCase().startsWith(plan.stacksOnLabel?.toLowerCase() ?? '__never__'),
      );
      if (!baseLabelMatch) continue;
      const childCode = labelToCode.get(plan.code);
      const baseCode = labelToCode.get(baseLabelMatch.code);
      if (!childCode || !baseCode) continue;
      const baseRow = await tx.plan.findUnique({
        where: { productId_code: { productId: product.id, code: baseCode } },
        select: { id: true },
      });
      if (!baseRow) continue;
      await tx.plan.update({
        where: { productId_code: { productId: product.id, code: childCode } },
        data: { stacksOn: baseRow.id },
      });
      stacksOnResolved += 1;
    }
  }

  return { productsUpserted, plansCreated, stacksOnResolved, productHandles };
}
