// =============================================================
// Catalogue context loader for the AI extraction prompt.
//
// Assembles a compact, prompt-friendly JSON snapshot of the tenant's
// catalogues and reference data. Goes into the system block (which
// is cached on Anthropic Foundry for 5 minutes), so a broker doing
// back-to-back imports pays the catalogue-encoding cost once.
//
// Why we send catalogue data at all: the LLM needs to map insurer-
// specific labels in the slip to canonical codes the rest of the
// system understands.
//   - "Tokio Marine Life" on the slip ⇒ Insurer.code = "TM_LIFE"
//   - "Group Term Life" sheet         ⇒ ProductType.code = "GTL"
//   - "Singapore" address             ⇒ Country.code = "SG"
//   - "NTUC GBT pool"                 ⇒ Pool.id = <some uuid>
//   - "Hay Job Grade 18+" eligibility ⇒ EmployeeSchema field path
//
// We deliberately omit anything large or unrelated (e.g. existing
// clients, audit logs). The prompt stays under ~30k tokens of
// catalogue JSON for a typical tenant.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';

export type CatalogueContext = {
  productTypes: Array<{
    code: string;
    name: string;
    premiumStrategy: string;
  }>;
  insurers: Array<{
    code: string;
    name: string;
    productsSupported: string[];
  }>;
  pools: Array<{
    id: string;
    name: string;
  }>;
  tpas: Array<{
    code: string;
    name: string;
  }>;
  employeeSchema: Array<{
    name: string;
    label: string;
    type: string;
    enumValues?: string[];
  }>;
  countries: Array<{
    code: string;
    name: string;
  }>;
  industries: Array<{
    code: string;
    name: string;
  }>;
  // The current ExtractionDraft id and tenant info so the prompt can
  // reference them in audit-style language ("the broker for tenant X
  // is reviewing draft Y") — soft hint, not load-bearing.
  meta: {
    tenantSlug: string;
  };
};

export async function loadCatalogueContext(
  db: TenantDb,
  tenantSlug: string,
): Promise<CatalogueContext> {
  const [productTypes, insurers, pools, tpas, employeeSchema, countries, industries] =
    await Promise.all([
      db.productType.findMany({
        select: { code: true, name: true, premiumStrategy: true },
        orderBy: { code: 'asc' },
      }),
      db.insurer.findMany({
        select: { code: true, name: true, productsSupported: true, active: true },
        where: { active: true },
        orderBy: { code: 'asc' },
      }),
      // Pool has no `active` column; every row is treated as live. If a
      // tenant deprecates a pool they delete the row (or rename it).
      db.pool.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      db.tPA.findMany({
        select: { code: true, name: true, active: true },
        where: { active: true },
        orderBy: { code: 'asc' },
      }),
      db.employeeSchema.findFirst({ select: { fields: true } }),
      // Countries / industries are not tenant-scoped; the bare prisma
      // client is the right tool. We only ever read.
      readGlobalCountries(db),
      readGlobalIndustries(db),
    ]);

  const fields =
    (employeeSchema?.fields as Array<{
      name: string;
      label: string;
      type: string;
      enumValues?: string[];
      enabled?: boolean;
    }> | null) ?? [];

  return {
    productTypes: productTypes.map((p) => ({
      code: p.code,
      name: p.name,
      premiumStrategy: p.premiumStrategy,
    })),
    insurers: insurers
      .filter((i) => i.active)
      .map((i) => ({
        code: i.code,
        name: i.name,
        productsSupported: i.productsSupported,
      })),
    pools: pools.map((p) => ({ id: p.id, name: p.name })),
    tpas: tpas.filter((t) => t.active).map((t) => ({ code: t.code, name: t.name })),
    employeeSchema: fields
      .filter((f) => f.enabled !== false && f.name)
      .map((f) => {
        const base: { name: string; label: string; type: string; enumValues?: string[] } = {
          name: f.name,
          label: f.label,
          type: f.type,
        };
        if (f.enumValues && f.enumValues.length > 0) base.enumValues = f.enumValues;
        return base;
      }),
    countries: countries.map((c) => ({ code: c.code, name: c.name })),
    industries: industries.map((i) => ({ code: i.code, name: i.name })),
    meta: { tenantSlug },
  };
}

// Countries / industries are global reference data — every tenant
// reads the same rows. They live on the bare Prisma client, not the
// tenant-extended one, because they have no tenantId column and the
// extension would attempt to inject one.
async function readGlobalCountries(
  db: TenantDb,
): Promise<Array<{ code: string; name: string }>> {
  // The tenant extension is a no-op on non-tenant models, so this
  // call is identical to one against the bare client. We keep the
  // signature db: TenantDb so callers don't have to thread a second
  // client through.
  // biome-ignore lint/suspicious/noExplicitAny: cross-tenant model on extended client
  const rows = await (db as any).country.findMany({
    select: { code: true, name: true },
    orderBy: { name: 'asc' },
  });
  return rows as Array<{ code: string; name: string }>;
}

async function readGlobalIndustries(
  db: TenantDb,
): Promise<Array<{ code: string; name: string }>> {
  // biome-ignore lint/suspicious/noExplicitAny: cross-tenant model on extended client
  const rows = await (db as any).industry.findMany({
    select: { code: true, name: true },
    orderBy: { code: 'asc' },
  });
  return rows as Array<{ code: string; name: string }>;
}
