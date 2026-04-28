// =============================================================
// prisma/seed-catalogue.ts — standalone catalogue-only seed runner.
//
// Used by `pnpm seed:catalogue` per S16 AC. Runs the product
// catalogue seed against every tenant in the database (idempotent:
// upserts on tenantId+code). Safe to re-run after schema edits.
//
// Why standalone: the full `pnpm db:seed` also creates the demo
// tenant, dev admin, and global reference data — overkill (and
// blocked in production). This runner only touches ProductType.
// =============================================================

import { PrismaClient } from '@prisma/client';
import { seedProductCatalogueForTenant } from './seeds/product-catalogue';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length === 0) {
    // biome-ignore lint/suspicious/noConsoleLog: intentional CLI output
    console.log('[seed:catalogue] no tenants found — run `pnpm db:seed` first.');
    return;
  }
  for (const t of tenants) {
    // biome-ignore lint/suspicious/noConsoleLog: intentional CLI output
    console.log(`[seed:catalogue] tenant ${t.name} (${t.id})`);
    await seedProductCatalogueForTenant(prisma, t.id);
  }
  // biome-ignore lint/suspicious/noConsoleLog: intentional CLI output
  console.log(`[seed:catalogue] done. ${tenants.length} tenant(s) updated.`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed:catalogue] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
