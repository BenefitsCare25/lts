// S11: Employee Schema seeding — initializes one row per tenant
// with the default built-in + standard fields.
//
// Idempotent: if a row already exists for the tenant we keep it
// untouched (the admin may have already enabled/disabled standards
// or added custom fields).

import { DEFAULT_EMPLOYEE_FIELDS } from '@insurance-saas/shared-types';
import type { PrismaClient } from '@prisma/client';

export async function seedEmployeeSchemaForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  await prisma.employeeSchema.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      version: 1,
      fields: DEFAULT_EMPLOYEE_FIELDS,
    },
  });
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(
    `[seed] employee schema initialised for tenant ${tenantId}: ${DEFAULT_EMPLOYEE_FIELDS.length} default fields`,
  );
}
