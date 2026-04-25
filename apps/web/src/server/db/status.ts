import "server-only";

import { prisma } from "./prisma";

export type DatabaseStatus = { ok: true; detail: string } | { ok: false; detail: string };

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  try {
    const [agencyCount, productTypeCount] = await Promise.all([
      prisma.agency.count(),
      prisma.productType.count(),
    ]);
    return {
      ok: true,
      detail: `${agencyCount} agency, ${productTypeCount} product types`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, detail: message };
  }
}
