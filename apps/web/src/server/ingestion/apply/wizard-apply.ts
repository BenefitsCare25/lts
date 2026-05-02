// =============================================================
// Wizard apply service — commits an ExtractionDraft to real
// catalogue rows in a single Prisma transaction.
//
// Creates:
//   - Client (new) or binds to an existing one
//   - Policy + PolicyEntities
//   - BenefitYear (DRAFT)
//   - Binds the orphan PlacementSlipUpload to the client
//   - Marks the ExtractionDraft as APPLIED
//   - Writes an AuditLog row
// =============================================================

import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import { ClientStatus, type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

export type WizardApplyParams = {
  tenantId: string;
  userId: string;
  draftId: string;
  uploadId: string;
  existingClientId: string | null;
  proposed: {
    client: {
      legalName: string;
      tradingName?: string | null | undefined;
      uen: string;
      countryOfIncorporation: string;
      address: string;
      industry?: string | null | undefined;
      primaryContactName?: string | null | undefined;
      primaryContactEmail?: string | null | undefined;
    } | null;
    policy: {
      name: string;
      ageBasis: 'POLICY_START' | 'HIRE_DATE' | 'AS_AT_EVENT';
    };
    policyEntities: Array<{
      legalName: string;
      policyNumber: string;
      address?: string | null | undefined;
      headcountEstimate?: number | null | undefined;
      isMaster: boolean;
    }>;
    benefitYear: {
      startDate: Date;
      endDate: Date;
      carryForwardFromYearId?: string | null | undefined;
    };
  };
};

export type WizardApplyResult = {
  clientId: string;
  policyId: string;
  benefitYearId: string;
  policyEntitiesCreated: number;
  productsCreated: number;
};

export async function applyWizardDraft(
  params: WizardApplyParams,
  // db is the tenant-scoped client — passed in so the caller controls
  // tenant context and this function stays testable in isolation.
  _db: TenantDb,
): Promise<WizardApplyResult> {
  const { tenantId, userId, draftId, uploadId, existingClientId, proposed } = params;

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Resolve / create the Client.
      let clientId: string;
      if (existingClientId) {
        const existing = await tx.client.findFirst({
          where: { id: existingClientId, tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
        }
        clientId = existing.id;
      } else {
        if (!proposed.client) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Client details required when creating a new client.',
          });
        }
        const c = proposed.client;
        const created = await tx.client.create({
          data: {
            tenantId,
            legalName: c.legalName,
            tradingName: c.tradingName ?? null,
            uen: c.uen,
            countryOfIncorporation: c.countryOfIncorporation,
            address: c.address,
            industry: c.industry ?? null,
            primaryContactName: c.primaryContactName ?? null,
            primaryContactEmail: c.primaryContactEmail ?? null,
            status: ClientStatus.ACTIVE,
          },
        });
        clientId = created.id;
      }

      // 2. Create the Policy.
      const policy = await tx.policy.create({
        data: {
          clientId,
          name: proposed.policy.name,
          ageBasis: proposed.policy.ageBasis,
        },
      });

      // 3. Create PolicyEntities (one per legal entity on the master
      // policy). The wizard guarantees exactly one master.
      await tx.policyEntity.createMany({
        data: proposed.policyEntities.map((entity) => ({
          policyId: policy.id,
          legalName: entity.legalName,
          policyNumber: entity.policyNumber,
          address: entity.address ?? null,
          headcountEstimate: entity.headcountEstimate ?? null,
          isMaster: entity.isMaster,
        })),
      });

      // 4. Create the BenefitYear in DRAFT.
      const benefitYear = await tx.benefitYear.create({
        data: {
          policyId: policy.id,
          startDate: proposed.benefitYear.startDate,
          endDate: proposed.benefitYear.endDate,
          state: 'DRAFT',
          carryForwardFromYearId: proposed.benefitYear.carryForwardFromYearId ?? null,
        },
      });

      // 5. Bind the orphan upload to the new client. This makes
      // re-listing under /admin/clients/[id]/imports surface this
      // upload normally; the orphan listOrphans query filters it out.
      await tx.placementSlipUpload.update({
        where: { id: uploadId },
        data: {
          clientId,
          parseStatus: 'APPLIED',
        },
      });

      // 6. Mark the draft applied.
      await tx.extractionDraft.update({
        where: { id: draftId },
        data: {
          status: 'APPLIED',
          appliedAt: new Date(),
          appliedById: userId,
        },
      });

      // 7. Audit. The tRPC middleware logs the mutation itself, but we
      // want a richer entity hint for the audit dashboard.
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'extractionDrafts.applyToCatalogue',
          entityType: 'Client',
          entityId: clientId,
          after: {
            clientId,
            policyId: policy.id,
            benefitYearId: benefitYear.id,
            draftId,
            uploadId,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        clientId,
        policyId: policy.id,
        benefitYearId: benefitYear.id,
        policyEntitiesCreated: proposed.policyEntities.length,
        // Products / Plans / PremiumRates / BenefitGroups /
        // ProductEligibility are written by the per-section apply
        // pipeline once the AI extractor module lands. Today the
        // wizard creates the foundational rows; per-product rows
        // are still created via the existing placementSlips.applyToCatalogue
        // call from the Products section.
        productsCreated: 0,
      };
    },
    { maxWait: 5_000, timeout: 60_000 },
  );

  return result;
}
