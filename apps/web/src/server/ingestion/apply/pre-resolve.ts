// =============================================================
// Pre-resolution pass for placement-slip apply.
//
// Walks the parsed products and resolves every (insurer, productType,
// pool) referenced into id caches BEFORE the apply transaction opens.
// Two reasons:
//
//   1. A missing-FK diagnostic surfaces with a friendly skipped[]
//      entry instead of a Prisma P2003 error mid-tx.
//   2. We avoid N+1 reads inside the open transaction. Pool resolution
//      previously ran one `findFirst` per product (Q4); now a single
//      `findMany({ where: { name: { in } } })` covers the whole slip.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';
import type { ParseResult, ParsingRules } from '@/server/ingestion/parser';

export type SkippedEntry = { reason: string; detail: string };

export type ProductTypeCacheEntry = {
  id: string;
  planSchema: unknown;
  premiumStrategy: string;
  parsingRules: unknown;
};

export type PreResolvedCatalogue = {
  insurerCache: Map<string, string>; // code → id
  productTypeCache: Map<string, ProductTypeCacheEntry>;
  poolCache: Map<string, string>; // normalised name → id
  skipped: SkippedEntry[];
};

// Pools are matched by exact `name` (already trimmed by the parser).
// "NA" / "N.A" / empty string are sentinels meaning "no pool" — they
// are excluded from the lookup.
function isPoolSentinel(name: string): boolean {
  return name === '' || name === 'NA' || name === 'N.A';
}

export async function preResolveCatalogue(
  db: TenantDb,
  parseResult: ParseResult,
): Promise<PreResolvedCatalogue> {
  const insurerCache = new Map<string, string>();
  const productTypeCache = new Map<string, ProductTypeCacheEntry>();
  const poolCache = new Map<string, string>();
  const skipped: SkippedEntry[] = [];

  // Collect every distinct ref upfront so we can issue one batch query
  // per registry instead of one round-trip per product.
  const insurerCodes = new Set<string>();
  const productTypeCodes = new Set<string>();
  const poolNames = new Set<string>();

  for (const parsed of parseResult.products) {
    insurerCodes.add(parsed.templateInsurerCode);
    productTypeCodes.add(parsed.productTypeCode);
    const poolName = String(parsed.fields.pool_name ?? '').trim();
    if (!isPoolSentinel(poolName)) poolNames.add(poolName);
  }

  if (insurerCodes.size > 0) {
    const insurers = await db.insurer.findMany({
      where: { code: { in: Array.from(insurerCodes) } },
      select: { id: true, code: true },
    });
    for (const ins of insurers) insurerCache.set(ins.code, ins.id);
  }
  if (productTypeCodes.size > 0) {
    const productTypes = await db.productType.findMany({
      where: { code: { in: Array.from(productTypeCodes) } },
      select: {
        id: true,
        code: true,
        planSchema: true,
        premiumStrategy: true,
        parsingRules: true,
      },
    });
    for (const pt of productTypes) {
      productTypeCache.set(pt.code, {
        id: pt.id,
        planSchema: pt.planSchema,
        premiumStrategy: pt.premiumStrategy,
        parsingRules: pt.parsingRules,
      });
    }
  }
  if (poolNames.size > 0) {
    const pools = await db.pool.findMany({
      where: { name: { in: Array.from(poolNames) } },
      select: { id: true, name: true },
    });
    for (const pool of pools) poolCache.set(pool.name, pool.id);
  }

  // Surface every missing FK as a skipped[] entry. The transaction
  // body skips these products via the cache .has() guards.
  for (const parsed of parseResult.products) {
    if (!insurerCache.has(parsed.templateInsurerCode)) {
      skipped.push({
        reason: 'INSURER_NOT_FOUND',
        detail: `${parsed.productTypeCode}: insurer "${parsed.templateInsurerCode}" not in registry. Add it via /admin/catalogue/insurers and re-apply.`,
      });
    }
    if (!productTypeCache.has(parsed.productTypeCode)) {
      skipped.push({
        reason: 'PRODUCT_TYPE_NOT_FOUND',
        detail: `Product type ${parsed.productTypeCode} missing from catalogue.`,
      });
    }
  }

  return { insurerCache, productTypeCache, poolCache, skipped };
}

// Pull the rate_column_map for a parsed product from the cached
// productType.parsingRules JSONB. Kept here so the orchestrator
// stays focused on writes.
export function getRateColumnMap(
  productTypeCache: Map<string, ProductTypeCacheEntry>,
  productTypeCode: string,
  templateInsurerCode: string,
): ParsingRules['rate_column_map'] | null {
  const pt = productTypeCache.get(productTypeCode);
  if (!pt) return null;
  const templates =
    (pt.parsingRules as { templates?: Record<string, ParsingRules> } | null)?.templates ?? {};
  const rules = templates[templateInsurerCode];
  return rules?.rate_column_map ?? null;
}
