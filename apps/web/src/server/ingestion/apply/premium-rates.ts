// =============================================================
// PremiumRate writer for placement-slip apply.
//
// Wipe-and-rebuild per product so re-applying a slip is deterministic.
// Reads the per-template `rate_column_map` from the cached
// productType.parsingRules JSONB; if absent, surfaces a skipped[]
// entry so the broker enters rates manually via the Premium tab.
// =============================================================

import { excelColumnIndex } from '@/server/catalogue/premium-strategy';
import type { ParseResult } from '@/server/ingestion/parser';
import type { Prisma } from '@prisma/client';
import { type PreResolvedCatalogue, type SkippedEntry, getRateColumnMap } from './pre-resolve';
import type { ProductHandle } from './products-and-plans';

export type PremiumRatesResult = { premiumRatesCreated: number };

export async function writePremiumRates(
  tx: Prisma.TransactionClient,
  parseResult: ParseResult,
  resolved: PreResolvedCatalogue,
  productHandles: ProductHandle[],
  skipped: SkippedEntry[],
): Promise<PremiumRatesResult> {
  let premiumRatesCreated = 0;

  // Index parsed products by productTypeCode for fast lookup.
  const parsedByType = new Map<string, ParseResult['products'][number]>();
  for (const p of parseResult.products) parsedByType.set(p.productTypeCode, p);

  for (const handle of productHandles) {
    const parsed = parsedByType.get(handle.productTypeCode);
    if (!parsed) continue;

    const map = getRateColumnMap(
      resolved.productTypeCache,
      handle.productTypeCode,
      handle.templateInsurerCode,
    );
    if (!map) {
      skipped.push({
        reason: 'NO_RATE_COLUMN_MAP',
        detail: `${handle.productTypeCode} via ${handle.templateInsurerCode}: parsingRules has no rate_column_map; rates can be entered via the Premium tab.`,
      });
      continue;
    }

    const allPlans = await tx.plan.findMany({
      where: { productId: handle.productId },
      select: { id: true, code: true, name: true },
    });
    const planByLabel = new Map<string, string>();
    for (const p of allPlans) {
      planByLabel.set(p.name.toLowerCase(), p.id);
      planByLabel.set(p.code.toLowerCase(), p.id);
    }

    const planMatchKey = `col${excelColumnIndex(map.planMatch)}`;

    // Wipe + rebuild so re-apply is deterministic.
    await tx.premiumRate.deleteMany({ where: { productId: handle.productId } });

    const ratesToCreate: {
      productId: string;
      planId: string;
      coverTier: string | null;
      ratePerThousand: number | null;
      fixedAmount: number | null;
    }[] = [];

    for (const rateRow of parsed.rates) {
      const rawLabel = rateRow[planMatchKey];
      if (!rawLabel) continue;
      const labelStr = String(rawLabel).trim().toLowerCase();
      let planId: string | undefined;
      for (const [k, v] of planByLabel) {
        if (k.startsWith(labelStr) || labelStr.startsWith(k)) {
          planId = v;
          break;
        }
      }
      if (!planId) continue;

      if (map.tiers && map.tiers.length > 0) {
        for (const t of map.tiers) {
          const cell = rateRow[`col${excelColumnIndex(t.rateColumn)}`];
          const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
          if (!Number.isFinite(num) || num <= 0) continue;
          ratesToCreate.push({
            productId: handle.productId,
            planId,
            coverTier: t.tier,
            ratePerThousand: null,
            fixedAmount: num,
          });
        }
      } else if (map.ratePerThousand) {
        const cell = rateRow[`col${excelColumnIndex(map.ratePerThousand)}`];
        const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
        if (Number.isFinite(num) && num > 0) {
          ratesToCreate.push({
            productId: handle.productId,
            planId,
            coverTier: null,
            ratePerThousand: num,
            fixedAmount: null,
          });
        }
      } else if (map.fixedAmount) {
        const cell = rateRow[`col${excelColumnIndex(map.fixedAmount)}`];
        const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
        if (Number.isFinite(num) && num > 0) {
          ratesToCreate.push({
            productId: handle.productId,
            planId,
            coverTier: null,
            ratePerThousand: null,
            fixedAmount: num,
          });
        }
      }
    }

    if (ratesToCreate.length > 0) {
      await tx.premiumRate.createMany({ data: ratesToCreate });
      premiumRatesCreated += ratesToCreate.length;
    }
  }

  return { premiumRatesCreated };
}
