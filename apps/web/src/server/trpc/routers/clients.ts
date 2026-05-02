// =============================================================
// Clients router.
//
// Fields per v2 §6.1: legalName, tradingName, uen,
// countryOfIncorporation, address, industry, primaryContactName,
// primaryContactEmail, status.
//
// UEN is validated server-side against Country.uenPattern (when
// the country has one set — SG / MY today). Country and Industry
// are system-level, but we still validate that the codes exist.
// =============================================================

import { prisma } from '@/server/db/client';
import { ClientStatus, Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

const clientInputSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradingName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  uen: z.string().trim().min(1).max(40),
  countryOfIncorporation: z.string().trim().length(2, 'Country code must be a 2-letter ISO code.'),
  address: z.string().trim().min(1).max(500),
  industry: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  primaryContactName: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  primaryContactEmail: z
    .string()
    .trim()
    .max(254)
    .email('Enter a valid email address.')
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : null)),
  status: z.nativeEnum(ClientStatus).default(ClientStatus.ACTIVE),
});

type ClientInput = z.infer<typeof clientInputSchema>;

// Validates UEN against the country's uenPattern (when one is set)
// and confirms the industry code exists when supplied. Throws
// BAD_REQUEST with a user-facing message on any miss.
async function assertCountryAndIndustry(input: ClientInput): Promise<void> {
  const country = await prisma.country.findUnique({
    where: { code: input.countryOfIncorporation },
    select: { code: true, name: true, uenPattern: true },
  });
  if (!country) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Country "${input.countryOfIncorporation}" is not a known ISO country code.`,
    });
  }
  if (country.uenPattern) {
    const re = new RegExp(country.uenPattern);
    if (!re.test(input.uen)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `UEN does not match the expected format for ${country.name}.`,
      });
    }
  }
  if (input.industry) {
    const industry = await prisma.industry.findUnique({
      where: { code: input.industry },
      select: { code: true },
    });
    if (!industry) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Industry code "${input.industry}" is not a known SSIC subclass.`,
      });
    }
  }
}

export const clientsRouter = router({
  list: tenantProcedure.query(({ ctx }) =>
    ctx.db.client.findMany({
      orderBy: [{ status: 'asc' }, { legalName: 'asc' }],
      select: {
        id: true,
        legalName: true,
        tradingName: true,
        uen: true,
        countryOfIncorporation: true,
        industry: true,
        status: true,
      },
    }),
  ),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const client = await ctx.db.client.findFirst({ where: { id: input.id } });
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
    return client;
  }),

  create: adminProcedure.input(clientInputSchema).mutation(async ({ ctx, input }) => {
    await assertCountryAndIndustry(input);
    return ctx.db.client.create({ data: { ...input, tenantId: ctx.tenantId } });
  }),

  update: adminProcedure
    .input(z.object({ id: z.string().min(1), data: clientInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCountryAndIndustry(input.data);
      try {
        return await ctx.db.client.update({ where: { id: input.id }, data: input.data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
        }
        throw err;
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        // Collect IDs needed for the cascade.
        const policies = await tx.policy.findMany({
          where: { clientId: input.id },
          select: { id: true },
        });
        const policyIds = policies.map((p) => p.id);

        const benefitYears = await tx.benefitYear.findMany({
          where: { policyId: { in: policyIds } },
          select: { id: true },
        });
        const byIds = benefitYears.map((b) => b.id);

        const products = await tx.product.findMany({
          where: { benefitYearId: { in: byIds } },
          select: { id: true },
        });
        const productIds = products.map((p) => p.id);

        // Delete leaf records with Restrict/no-cascade constraints first.
        const planIds = await tx.plan
          .findMany({ where: { productId: { in: productIds } }, select: { id: true } })
          .then((r) => r.map((p) => p.id));
        // PlanStack.parent has onDelete:Restrict — must remove stacking links before
        // deleting plans. PlanStack is not in the tenant-model set so it's not on the
        // typed tx; raw SQL is the only path inside this transaction.
        if (planIds.length > 0) {
          await tx.$executeRaw`DELETE FROM "PlanStack" WHERE "childId" = ANY(${planIds}::text[])`;
        }
        await tx.premiumRate.deleteMany({ where: { productId: { in: productIds } } });
        await tx.productEligibility.deleteMany({ where: { productId: { in: productIds } } });
        await tx.plan.deleteMany({ where: { productId: { in: productIds } } });
        await tx.product.deleteMany({ where: { benefitYearId: { in: byIds } } });
        await tx.benefitYear.deleteMany({ where: { policyId: { in: policyIds } } });
        await tx.policyEntity.deleteMany({ where: { policyId: { in: policyIds } } });

        // Deleting policies cascades: PolicyException, FlexBundle→FlexBundlePlan, Enrollment.
        await tx.policy.deleteMany({ where: { clientId: input.id } });

        // Employees: delete dependents first (no cascade), then employees.
        // Enrollments and PolicyExceptions are already gone via the policy cascade above.
        const employees = await tx.employee.findMany({
          where: { clientId: input.id },
          select: { id: true },
        });
        const employeeIds = employees.map((e) => e.id);
        await tx.dependent.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.employee.deleteMany({ where: { clientId: input.id } });

        // Unlink uploads — clientId is nullable, so just nullify rather than delete.
        await tx.placementSlipUpload.updateMany({
          where: { clientId: input.id },
          data: { clientId: null },
        });

        await tx.client.delete({ where: { id: input.id } });
      });

      return { id: input.id };
    }),
});
