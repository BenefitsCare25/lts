// =============================================================
// review.publish integration tests.
//
// Covers the publish gate's correctness contracts:
//   1. Happy path — DRAFT BenefitYear with no blockers, expected
//      versionId matches → state transitions to PUBLISHED, versionId
//      bumps, publishedAt + publishedBy stamped.
//   2. Optimistic-lock conflict — caller sends a stale
//      `expectedPolicyVersionId` (someone else updated the policy
//      first) → CONFLICT, no state change.
//   3. Blocker present — validate() reports a blocker before publish
//      is called → publish rejects with BAD_REQUEST.
//   4. Already published — second publish call on the same
//      BenefitYear → BAD_REQUEST (state isn't DRAFT).
//   5. Idempotency-of-failure — failing publish leaves state untouched.
//
// Skipped unless INTEGRATION_DATABASE_URL is set.
// =============================================================

import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type SeededTenant,
  callerFor,
  integrationEnabled,
  seedTwoTenants,
  testPrisma,
  truncateAll,
} from './setup';

const itIf = integrationEnabled ? it : it.skip;
const describeIf = integrationEnabled ? describe : describe.skip;

// Seed a publishable BenefitYear: one product with a valid plan,
// matching insurer support, and a master entity. The seed in
// setup.ts only creates Tenant + User + Insurer + Client + Policy +
// BenefitYear + Employee — we layer the rest on top here.
async function seedPublishable(seeded: SeededTenant) {
  // Master entity for the policy (NO_ENTITIES blocker).
  await testPrisma.policyEntity.create({
    data: {
      policyId: seeded.policyId,
      policyNumber: 'POL-001',
      legalName: 'Master Entity',
      isMaster: true,
    },
  });

  // ProductType — minimum schemas that accept any object so review.validate
  // doesn't reject the seeded product/plan.
  const productType = await testPrisma.productType.create({
    data: {
      tenantId: seeded.tenantId,
      code: 'GTL',
      name: 'Group Term Life',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      planSchema: { type: 'object', properties: {}, additionalProperties: true },
      premiumStrategy: 'per_individual_fixed_sum',
      version: 1,
    },
  });

  // Product — needs Insurer.productsSupported to include the type code.
  await testPrisma.insurer.update({
    where: { id: seeded.insurerId },
    data: { productsSupported: ['GTL', 'GHS'] },
  });
  const product = await testPrisma.product.create({
    data: {
      benefitYearId: seeded.benefitYearId,
      productTypeId: productType.id,
      insurerId: seeded.insurerId,
      data: { insurer: 'TM_LIFE', policy_number: 'POL-001' },
    },
  });

  // Plan with a non-empty schedule (planSchema is permissive).
  await testPrisma.plan.create({
    data: {
      productId: product.id,
      code: 'PA',
      name: 'Plan A',
      coverBasis: 'fixed_amount',
      schedule: { sumAssured: 100_000 },
    },
  });

  return { productTypeId: productType.id, productId: product.id };
}

describeIf('review.publish (DB-backed)', () => {
  let seeded: SeededTenant;

  beforeEach(async () => {
    await truncateAll();
    const t = await seedTwoTenants();
    seeded = t.a;
    await seedPublishable(seeded);
  });

  itIf('happy path: transitions DRAFT → PUBLISHED, bumps versionId', async () => {
    const a = callerFor(seeded.userId);
    const policyBefore = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });

    const result = await a.review.publish({
      benefitYearId: seeded.benefitYearId,
      expectedPolicyVersionId: policyBefore.versionId,
      acknowledgedWarnings: [],
    });

    expect(result.state).toBe('PUBLISHED');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.publishedBy).toBe(seeded.userId);

    const policyAfter = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });
    expect(policyAfter.versionId).toBe(policyBefore.versionId + 1);

    const byAfter = await testPrisma.benefitYear.findUniqueOrThrow({
      where: { id: seeded.benefitYearId },
    });
    expect(byAfter.state).toBe('PUBLISHED');
  });

  itIf('rejects with CONFLICT when expectedPolicyVersionId is stale', async () => {
    const a = callerFor(seeded.userId);
    const policy = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });

    await expect(
      a.review.publish({
        benefitYearId: seeded.benefitYearId,
        expectedPolicyVersionId: policy.versionId + 99, // stale
        acknowledgedWarnings: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // State unchanged.
    const byAfter = await testPrisma.benefitYear.findUniqueOrThrow({
      where: { id: seeded.benefitYearId },
    });
    expect(byAfter.state).toBe('DRAFT');
    expect(byAfter.publishedAt).toBeNull();
  });

  itIf('rejects with BAD_REQUEST when blockers remain', async () => {
    // Remove the master entity so NO_ENTITIES becomes a blocker. (We
    // need to delete *all* entities — the validation reports the
    // blocker only when entities.length === 0.)
    await testPrisma.policyEntity.deleteMany({
      where: { policyId: seeded.policyId },
    });

    const a = callerFor(seeded.userId);
    const policy = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });

    await expect(
      a.review.publish({
        benefitYearId: seeded.benefitYearId,
        expectedPolicyVersionId: policy.versionId,
        acknowledgedWarnings: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const byAfter = await testPrisma.benefitYear.findUniqueOrThrow({
      where: { id: seeded.benefitYearId },
    });
    expect(byAfter.state).toBe('DRAFT');
  });

  itIf('rejects publishing an already-PUBLISHED benefit year', async () => {
    const a = callerFor(seeded.userId);
    const policy = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });

    // First publish succeeds.
    await a.review.publish({
      benefitYearId: seeded.benefitYearId,
      expectedPolicyVersionId: policy.versionId,
      acknowledgedWarnings: [],
    });

    // Second attempt — even with a fresh versionId — must reject.
    const policyAfterFirst = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });
    await expect(
      a.review.publish({
        benefitYearId: seeded.benefitYearId,
        expectedPolicyVersionId: policyAfterFirst.versionId,
        acknowledgedWarnings: [],
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  itIf('writes an AuditLog row capturing the publish before/after', async () => {
    const a = callerFor(seeded.userId);
    const policy = await testPrisma.policy.findUniqueOrThrow({
      where: { id: seeded.policyId },
    });

    await a.review.publish({
      benefitYearId: seeded.benefitYearId,
      expectedPolicyVersionId: policy.versionId,
      acknowledgedWarnings: [],
    });

    // Audit middleware fires fire-and-forget (H10). Wait briefly so
    // the dispatched promise can land before we read.
    await new Promise((r) => setTimeout(r, 100));

    const logs = await testPrisma.auditLog.findMany({
      where: { entityType: 'BenefitYear', entityId: seeded.benefitYearId },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const publishLog = logs.find((l) => l.action === 'review.publish');
    expect(publishLog).toBeDefined();
    expect(publishLog?.userId).toBe(seeded.userId);
  });
});
