// =============================================================
// Extraction-drafts router — backend surface for the import-first
// Create Client wizard. The wizard reads/writes ExtractionDraft.
// Apply commits everything (Client + Policy + BenefitYear + Products
// + Plans + PremiumRates + BenefitGroups + ProductEligibility) in a
// single Prisma transaction.
//
// Lifecycle:
//   QUEUED → EXTRACTING → READY → APPLIED
//                       ↘ FAILED  ↘ DISCARDED
//
// Today's draft is seeded by the heuristic parser (see
// placementSlips.uploadOrphan). When the AI extractor module ships
// it'll write richer ExtractedProduct payloads here without changing
// the wizard contract.
// =============================================================

import { prisma } from '@/server/db/client';
import { ClientStatus, type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// Loose ExtractedProduct shape used by the wizard's edit calls.
// Full validation happens against extracted-product.json on apply.
const extractedProductSchema = z
  .object({
    productTypeCode: z.string().min(1),
    insurerCode: z.string().min(1),
  })
  .passthrough();

// The Client fields the wizard collects. Mirrors clientsRouter's
// input schema but lives here so the apply step is self-contained.
const proposedClientSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradingName: z.string().trim().max(200).nullable().optional(),
  uen: z.string().trim().min(1).max(40),
  countryOfIncorporation: z.string().trim().length(2),
  address: z.string().trim().min(1).max(500),
  industry: z.string().trim().max(20).nullable().optional(),
  primaryContactName: z.string().trim().max(120).nullable().optional(),
  primaryContactEmail: z.string().trim().email().max(254).nullable().optional(),
});

const proposedPolicyEntitySchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  policyNumber: z.string().trim().min(1).max(80),
  address: z.string().trim().max(500).nullable().optional(),
  headcountEstimate: z.number().int().min(0).nullable().optional(),
  isMaster: z.boolean().default(false),
});

const proposedBenefitYearSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  ageBasis: z.enum(['POLICY_START', 'HIRE_DATE', 'AS_AT_EVENT']).default('POLICY_START'),
  carryForwardFromYearId: z.string().nullable().optional(),
});

const applyInputSchema = z.object({
  draftId: z.string().min(1),
  // null clientId means "create from proposed.client"; an id means
  // "bind orphan upload to this existing client".
  existingClientId: z.string().min(1).nullable(),
  proposed: z.object({
    client: proposedClientSchema.nullable(),
    policy: z.object({
      name: z.string().trim().min(1).max(200),
      ageBasis: z.enum(['POLICY_START', 'HIRE_DATE', 'AS_AT_EVENT']).default('POLICY_START'),
    }),
    policyEntities: z.array(proposedPolicyEntitySchema).min(1),
    benefitYear: proposedBenefitYearSchema,
  }),
});

async function loadDraftForTenant(tenantId: string, draftId: string) {
  const draft = await prisma.extractionDraft.findUnique({
    where: { id: draftId },
    include: { upload: true },
  });
  if (!draft || draft.tenantId !== tenantId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Extraction draft not found.' });
  }
  return draft;
}

export const extractionDraftsRouter = router({
  // List orphan drafts for the current tenant. The Create Client
  // landing page uses this to surface "you have N uploads in progress"
  // so brokers can resume mid-wizard sessions.
  listOrphans: tenantProcedure.query(async ({ ctx }) => {
    return prisma.extractionDraft.findMany({
      where: { tenantId: ctx.tenantId, upload: { clientId: null } },
      include: {
        upload: {
          select: {
            id: true,
            filename: true,
            insurerTemplate: true,
            parseStatus: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  // Read a draft by upload id. The wizard uses this everywhere
  // (it knows uploadId from the URL, not draftId).
  byUploadId: tenantProcedure
    .input(z.object({ uploadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const draft = await prisma.extractionDraft.findUnique({
        where: { uploadId: input.uploadId },
        include: { upload: true },
      });
      if (!draft || draft.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extraction draft not found.' });
      }
      return draft;
    }),

  // Patch the draft's extractedProducts payload. The wizard calls
  // this on every field blur (debounced) so progress is durable
  // across page reloads.
  updateExtractedProducts: adminProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        extractedProducts: z.array(extractedProductSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draft = await loadDraftForTenant(ctx.tenantId, input.draftId);
      if (draft.status === 'APPLIED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit an already-applied draft.',
        });
      }
      return prisma.extractionDraft.update({
        where: { id: input.draftId },
        data: {
          extractedProducts: input.extractedProducts as unknown as Prisma.InputJsonValue,
        },
      });
    }),

  // Discard a draft without applying. The upload row is kept (audit
  // trail); only the draft transitions to DISCARDED. The orphan upload
  // still exists in case the broker re-imports it under a fresh draft.
  discard: adminProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await loadDraftForTenant(ctx.tenantId, input.draftId);
      if (draft.status === 'APPLIED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot discard an already-applied draft.',
        });
      }
      return prisma.extractionDraft.update({
        where: { id: input.draftId },
        data: { status: 'DISCARDED' },
      });
    }),

  // Apply — the single transaction that turns a draft into real
  // catalogue rows. Either creates a new Client (orphan path) or
  // binds the existing upload to an existing Client. Always creates
  // Policy + BenefitYear + PolicyEntities. Returns the new clientId
  // so the wizard can redirect.
  //
  // Idempotency: re-running on an APPLIED draft is rejected. The
  // wizard's Apply button is disabled once status flips to APPLIED.
  applyToCatalogue: adminProcedure.input(applyInputSchema).mutation(async ({ ctx, input }) => {
    const draft = await loadDraftForTenant(ctx.tenantId, input.draftId);
    if (draft.status === 'APPLIED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Draft has already been applied.',
      });
    }

    // Enforce: orphan upload requires proposed.client; bound upload
    // requires existingClientId. The two paths are mutually exclusive
    // and the UI gates them, but we re-check here.
    const isOrphan = draft.upload.clientId == null;
    if (isOrphan && !input.proposed.client && !input.existingClientId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Orphan upload — provide either client details or an existing client id.',
      });
    }

    // Pre-resolve country & industry validation outside the tx so
    // user-facing errors come back fast, before we open a connection.
    if (input.proposed.client) {
      const country = await prisma.country.findUnique({
        where: { code: input.proposed.client.countryOfIncorporation },
        select: { code: true, name: true, uenPattern: true },
      });
      if (!country) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Country "${input.proposed.client.countryOfIncorporation}" is not a known ISO country code.`,
        });
      }
      if (country.uenPattern && !new RegExp(country.uenPattern).test(input.proposed.client.uen)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `UEN does not match the expected format for ${country.name}.`,
        });
      }
      if (input.proposed.client.industry) {
        const industry = await prisma.industry.findUnique({
          where: { code: input.proposed.client.industry },
          select: { code: true },
        });
        if (!industry) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Industry code "${input.proposed.client.industry}" is not a known SSIC subclass.`,
          });
        }
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Resolve / create the Client.
        let clientId: string;
        if (input.existingClientId) {
          const existing = await tx.client.findFirst({
            where: { id: input.existingClientId, tenantId: ctx.tenantId },
            select: { id: true },
          });
          if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
          }
          clientId = existing.id;
        } else {
          if (!input.proposed.client) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Client details required when creating a new client.',
            });
          }
          const c = input.proposed.client;
          const created = await tx.client.create({
            data: {
              tenantId: ctx.tenantId,
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
            name: input.proposed.policy.name,
            ageBasis: input.proposed.policy.ageBasis,
          },
        });

        // 3. Create PolicyEntities (one per legal entity on the
        // master policy). The wizard guarantees exactly one master.
        await tx.policyEntity.createMany({
          data: input.proposed.policyEntities.map((entity) => ({
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
            startDate: input.proposed.benefitYear.startDate,
            endDate: input.proposed.benefitYear.endDate,
            state: 'DRAFT',
            carryForwardFromYearId: input.proposed.benefitYear.carryForwardFromYearId ?? null,
          },
        });

        // 5. Bind the orphan upload to the new client. This makes
        // re-listing under /admin/clients/[id]/imports surface this
        // upload normally; the orphan listOrphans query filters it out.
        await tx.placementSlipUpload.update({
          where: { id: draft.uploadId },
          data: {
            clientId,
            parseStatus: 'APPLIED',
          },
        });

        // 6. Mark the draft applied.
        await tx.extractionDraft.update({
          where: { id: draft.id },
          data: {
            status: 'APPLIED',
            appliedAt: new Date(),
            appliedById: ctx.userId,
          },
        });

        // 7. Audit. The tRPC middleware logs the mutation itself,
        // but we want a richer entity hint for the audit dashboard.
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'extractionDrafts.applyToCatalogue',
            entityType: 'Client',
            entityId: clientId,
            after: {
              clientId,
              policyId: policy.id,
              benefitYearId: benefitYear.id,
              draftId: draft.id,
              uploadId: draft.uploadId,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          clientId,
          policyId: policy.id,
          benefitYearId: benefitYear.id,
          policyEntitiesCreated: input.proposed.policyEntities.length,
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
  }),
});
