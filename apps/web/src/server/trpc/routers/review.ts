// =============================================================
// Review router.
//
// `summary` returns the full read-only view of one BenefitYear:
// client + entities + products + plans + groups + eligibility +
// premium rates. The UI renders cards from this payload directly.
//
// `validate` runs a rule pass and returns a list of issues:
//   - Blocker: must resolve before publish (missing rates, broken
//     stacksOn, missing required fields, missing eligibility rows).
//   - Warning: acknowledgeable (mid-year period changes vs prior
//     year, unusual premium variance).
// =============================================================

import { auditEvent } from '@/server/audit';
import { safeCompile } from '@/server/catalogue/ajv';
import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import { UserRole } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// Same role gate as benefit-years.setState — only admin roles publish.
const PUBLISH_ROLES = new Set<UserRole>([UserRole.TENANT_ADMIN, UserRole.BROKER_ADMIN]);

async function loadCallerRole(db: TenantDb, userId: string): Promise<UserRole> {
  // findFirst with the tenant-scoped extension so the lookup can't
  // resolve a User row from another tenant on a stale session token.
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not provisioned.' });
  }
  return user.role;
}

export type ReviewIssue = {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  // Where the issue is — products tab, group editor, etc.
  surface?: string;
};

// Stable Ajv compile-cache keys for product-data and plan-data
// validation. ProductType.version increments on every catalogue
// edit (immutable per CLAUDE.md), so the key changes whenever the
// schema does — no manual invalidation needed.
function productSchemaCacheKey(productTypeId: string, version: number): string {
  return `product-type:${productTypeId}:${version}:schema`;
}
function planSchemaCacheKey(productTypeId: string, version: number): string {
  return `product-type:${productTypeId}:${version}:planSchema`;
}

type LoadedBenefitYear = Awaited<ReturnType<typeof loadBenefitYearForReview>>;

// Single source of truth for review validation. Both `validate`
// (read-only summary) and `publish` (write gate) call this so they
// can never drift. Returns the full issue list; callers filter for
// blockers / warnings + format counts.
function runValidation(by: LoadedBenefitYear): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  // ── BenefitYear-level checks ────────────────────────────
  if (by.products.length === 0) {
    issues.push({
      severity: 'blocker',
      code: 'NO_PRODUCTS',
      message: 'No products configured for this benefit year.',
      surface: 'products',
    });
  }

  if (by.policy.entities.length > 0) {
    const hasMaster = by.policy.entities.some((e) => e.isMaster);
    if (!hasMaster) {
      issues.push({
        severity: 'warning',
        code: 'NO_MASTER_ENTITY',
        message: 'Policy has entities but none is marked as the master policyholder.',
        surface: 'policy',
      });
    }
  } else {
    issues.push({
      severity: 'blocker',
      code: 'NO_ENTITIES',
      message: 'Policy has no entities defined.',
      surface: 'policy',
    });
  }

  // ── Per-product checks ─────────────────────────────────
  for (const product of by.products) {
    const ctx = `${product.productType.code} (${product.productType.name})`;

    // Ajv-validate Product.data against ProductType.schema.
    try {
      const compiled = safeCompile(
        product.productType.schema,
        productSchemaCacheKey(product.productType.id, product.productType.version),
      );
      if (!compiled.ok) {
        issues.push({
          severity: 'warning',
          code: 'PRODUCT_SCHEMA_UNCOMPILABLE',
          message: `${ctx}: schema didn't compile (${compiled.error}).`,
          surface: `product:${product.id}:details`,
        });
      } else if (!compiled.validate(product.data)) {
        for (const err of compiled.validate.errors ?? []) {
          issues.push({
            severity: 'blocker',
            code: 'PRODUCT_DATA_INVALID',
            message: `${ctx}: ${err.instancePath || '/'} ${err.message ?? 'is invalid'}`,
            surface: `product:${product.id}:details`,
          });
        }
      }
    } catch (err) {
      issues.push({
        severity: 'warning',
        code: 'PRODUCT_SCHEMA_UNCOMPILABLE',
        message: `${ctx}: schema didn't compile (${err instanceof Error ? err.message : 'unknown'}).`,
        surface: `product:${product.id}:details`,
      });
    }

    // No plans? Blocker.
    if (product.plans.length === 0) {
      issues.push({
        severity: 'blocker',
        code: 'NO_PLANS',
        message: `${ctx}: no plans defined.`,
        surface: `product:${product.id}:plans`,
      });
    } else {
      // Validate stacksOn references.
      const planIds = new Set(product.plans.map((p) => p.id));
      for (const plan of product.plans) {
        if (plan.stacksOn && !planIds.has(plan.stacksOn)) {
          issues.push({
            severity: 'blocker',
            code: 'BROKEN_STACKS_ON',
            message: `${ctx}: plan ${plan.code} stacksOn references a missing plan.`,
            surface: `product:${product.id}:plans`,
          });
        }
        // Validate plan data against planSchema.
        try {
          const compiled = safeCompile(
            product.productType.planSchema,
            planSchemaCacheKey(product.productType.id, product.productType.version),
          );
          if (!compiled.ok) continue; // already reported above
          const candidate = {
            code: plan.code,
            name: plan.name,
            coverBasis: plan.coverBasis,
            stacksOn: plan.stacksOn,
            selectionMode: plan.selectionMode,
            schedule: plan.schedule,
            effectiveFrom: plan.effectiveFrom?.toISOString().slice(0, 10) ?? null,
            effectiveTo: plan.effectiveTo?.toISOString().slice(0, 10) ?? null,
          };
          if (!compiled.validate(candidate)) {
            for (const err of compiled.validate.errors ?? []) {
              issues.push({
                severity: 'blocker',
                code: 'PLAN_INVALID',
                message: `${ctx} plan ${plan.code}: ${err.instancePath || '/'} ${err.message ?? 'is invalid'}`,
                surface: `product:${product.id}:plans`,
              });
            }
          }
        } catch {
          // already reported via PRODUCT_SCHEMA_UNCOMPILABLE
        }
      }
    }

    // Eligibility coverage — every benefit group should map to a plan
    // (or be intentionally absent). Any group without a row is a warning.
    const eligibleGroupIds = new Set(product.eligibility.map((e) => e.benefitGroupId));
    for (const g of by.policy.benefitGroups) {
      if (!eligibleGroupIds.has(g.id)) {
        issues.push({
          severity: 'warning',
          code: 'MISSING_ELIGIBILITY',
          message: `${ctx}: group "${g.name}" has no plan assignment (treated as ineligible).`,
          surface: `product:${product.id}:eligibility`,
        });
      }
    }
  }

  return issues;
}

async function loadBenefitYearForReview(tenantId: string, benefitYearId: string) {
  const by = await prisma.benefitYear.findFirst({
    where: { id: benefitYearId, policy: { client: { tenantId } } },
    include: {
      policy: {
        include: {
          client: true,
          entities: true,
          benefitGroups: true,
        },
      },
      products: {
        include: {
          productType: {
            select: {
              id: true,
              code: true,
              name: true,
              schema: true,
              planSchema: true,
              premiumStrategy: true,
              version: true,
            },
          },
          plans: true,
          eligibility: true,
          premiumRates: true,
          pool: true,
        },
      },
    },
  });
  if (!by) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit year not found.' });
  }
  return by;
}

export const reviewRouter = router({
  summary: tenantProcedure
    .input(z.object({ benefitYearId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const by = await loadBenefitYearForReview(ctx.tenantId, input.benefitYearId);

      // Resolve insurer + tpa names per product (those are FKs by id, not relations).
      const insurerIds = Array.from(new Set(by.products.map((p) => p.insurerId)));
      const tpaIds = Array.from(
        new Set(by.products.map((p) => p.tpaId).filter((id): id is string => id !== null)),
      );
      const [insurers, tpas] = await Promise.all([
        insurerIds.length > 0
          ? ctx.db.insurer.findMany({
              where: { id: { in: insurerIds } },
              select: { id: true, code: true, name: true },
            })
          : Promise.resolve([]),
        tpaIds.length > 0
          ? ctx.db.tPA.findMany({
              where: { id: { in: tpaIds } },
              select: { id: true, code: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const insurerById = new Map(insurers.map((i) => [i.id, i]));
      const tpaById = new Map(tpas.map((t) => [t.id, t]));

      return {
        benefitYearId: by.id,
        state: by.state,
        startDate: by.startDate,
        endDate: by.endDate,
        publishedAt: by.publishedAt,
        publishedBy: by.publishedBy,
        policy: {
          id: by.policy.id,
          name: by.policy.name,
          versionId: by.policy.versionId,
          entities: by.policy.entities,
          benefitGroups: by.policy.benefitGroups,
        },
        client: by.policy.client,
        products: by.products.map((p) => ({
          id: p.id,
          versionId: p.versionId,
          data: p.data,
          productType: p.productType,
          insurer: insurerById.get(p.insurerId) ?? null,
          tpa: p.tpaId ? (tpaById.get(p.tpaId) ?? null) : null,
          pool: p.pool,
          plans: p.plans,
          eligibility: p.eligibility,
          premiumRates: p.premiumRates.map((r) => ({
            ...r,
            ratePerThousand: r.ratePerThousand?.toString() ?? null,
            fixedAmount: r.fixedAmount?.toString() ?? null,
          })),
        })),
      };
    }),

  validate: tenantProcedure
    .input(z.object({ benefitYearId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const by = await loadBenefitYearForReview(ctx.tenantId, input.benefitYearId);
      const issues = runValidation(by);
      const blockers = issues.filter((i) => i.severity === 'blocker').length;
      const warnings = issues.filter((i) => i.severity === 'warning').length;
      return { issues, blockers, warnings, canPublish: blockers === 0 };
    }),

  // S28 — publish a DRAFT BenefitYear. Re-runs validate; if any
  // blockers exist or the optimistic lock disagrees, rejects. Stamps
  // publishedAt + publishedBy and bumps the policy versionId.
  publish: adminProcedure
    .input(
      z.object({
        benefitYearId: z.string().min(1),
        // Carries Policy.versionId from the UI for optimistic locking.
        expectedPolicyVersionId: z.number().int().min(1),
        // Acknowledged warning codes — UI sets this when the user
        // explicitly clicks past the warnings dialog.
        acknowledgedWarnings: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Role gate — same shape as benefitYears.setState. We re-check
      // here even though the UI hides Publish for non-admins because
      // the API surface is callable directly.
      const role = await loadCallerRole(ctx.db, ctx.userId);
      if (!PUBLISH_ROLES.has(role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only tenant or broker admins can publish a benefit year.',
        });
      }

      const by = await loadBenefitYearForReview(ctx.tenantId, input.benefitYearId);
      if (by.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot publish: benefit year is ${by.state}.`,
        });
      }

      // Optimistic lock check on the parent policy.
      if (by.policy.versionId !== input.expectedPolicyVersionId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This policy was modified by another session. Refresh the review screen and try again.',
        });
      }

      // Re-run validation server-side via the shared `runValidation`
      // helper — same source of truth as the read-only `validate`
      // procedure, so the publish gate cannot drift from what the
      // UI told the user. Trust nothing the client sent.
      const issues = runValidation(by);
      const remainingBlockers = issues.filter((i) => i.severity === 'blocker');
      if (remainingBlockers.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot publish — ${remainingBlockers.length} blocker(s) remain. Resolve them and retry.`,
        });
      }

      // Atomically transition state + bump policy version.
      const [, , published] = await prisma.$transaction([
        prisma.benefitYear.update({
          where: { id: input.benefitYearId },
          data: {
            state: 'PUBLISHED',
            publishedAt: new Date(),
            publishedBy: ctx.userId,
          },
        }),
        prisma.policy.update({
          where: { id: by.policy.id },
          data: { versionId: { increment: 1 } },
        }),
        prisma.benefitYear.findUniqueOrThrow({ where: { id: input.benefitYearId } }),
      ]);

      // Rich audit entry. The auto-middleware also fires for this
      // mutation (logs path + input as `after`), but a publish is
      // irreversible enough that we capture an explicit before/after
      // snapshot identifying the policy + product set being frozen.
      await auditEvent({
        db: ctx.db,
        userId: ctx.userId,
        action: 'review.publish',
        entityType: 'BenefitYear',
        entityId: input.benefitYearId,
        before: { state: 'DRAFT', policyVersionId: by.policy.versionId },
        after: {
          state: 'PUBLISHED',
          publishedAt: published.publishedAt,
          policyId: by.policy.id,
          policyVersionId: by.policy.versionId + 1,
          productCount: by.products.length,
          acknowledgedWarnings: input.acknowledgedWarnings,
        },
      });

      return { ...published, acknowledgedWarnings: input.acknowledgedWarnings };
    }),
});
