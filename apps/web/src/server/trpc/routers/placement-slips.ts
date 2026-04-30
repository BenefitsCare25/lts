// =============================================================
// Placement slips router (S29-S32 — Phase 1G ingestion).
//
// Upload accepts a base64-encoded XLSX from the broker; parses
// synchronously (Phase 1 scale doesn't justify the BullMQ round-
// trip yet); writes a PlacementSlipUpload row with the structured
// parseResult; returns the result so the review UI can render
// without a second round-trip.
//
// Storage: SharePoint via Microsoft Graph (`server/storage/sharepoint.ts`).
// Files live at /me/drive/root:/lts-placement-slips/<tenantSlug>/<clientId>/<filename>.
// `storageKey` carries the SharePoint path so re-parse can fetch
// the bytes without re-upload. Falls back to "inline:" markers
// when Azure AD env vars are missing (local dev without ROPC).
//
// Apply pipeline lives under `server/ingestion/apply/*`. This file
// is intentionally thin — orchestration only.
// =============================================================

import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import { extractFromWorkbook } from '@/server/extraction/extractor';
import { applyParsedToCatalogue } from '@/server/ingestion/apply/orchestrator';
import { type ParseResult, type ParsingRules, parsePlacementSlip } from '@/server/ingestion/parser';
import {
  deleteFile as deleteFromSharePoint,
  downloadFile as downloadFromSharePoint,
  ensureFolder,
  isSharePointConfigured,
  placementSlipFolder,
  uploadFile as uploadToSharePoint,
} from '@/server/storage/sharepoint';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// PlacementSlipUpload is in TENANT_MODELS — `ctx.db` auto-injects
// tenantId on every CRUD. The bare `prisma` import is reserved for
// non-tenant-scoped models (BenefitYear, PolicyEntity, etc., which
// gate via parent FK joins).

async function assertClient(db: TenantDb, clientId: string): Promise<void> {
  const client = await db.client.findFirst({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
  }
}

// Tenant-gating walks both shapes:
//   bound upload  — clientId is set; verify the client belongs to ctx.tenant
//   orphan upload — clientId is null; auto-tenant filter on ctx.db handles it
// The direct tenantId column was added in 20260430140000 to make orphan
// uploads possible (the wizard creates them on /admin/clients/new
// before any client exists).
async function loadUploadForTenant(db: TenantDb, uploadId: string) {
  // ctx.db auto-filters by tenantId — a row from another tenant is
  // invisible (returns null) without a manual cross-check.
  const upload = await db.placementSlipUpload.findFirst({ where: { id: uploadId } });
  if (!upload) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found.' });
  }
  if (upload.clientId) {
    await assertClient(db, upload.clientId);
  }
  return upload;
}

// Magic-byte sniff: accepts both .xlsx (ZIP signature PK\x03\x04)
// and .xls (CFB / OLE2 signature D0 CF 11 E0 A1 B1 1A E1). Throws
// BAD_REQUEST early so the parser doesn't allocate state on a non-
// Excel file. The .xls path normalises to .xlsx in-memory inside
// parser.ts via xls-to-xlsx.ts.
function assertExcelBuffer(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty file.' });
  }
  if (buffer.length > 25 * 1024 * 1024) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds 25 MB limit.' });
  }
  const isXlsx =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  const isXls =
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1;
  if (!isXlsx && !isXls) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File is not a valid Excel workbook (.xls or .xlsx).',
    });
  }
}

// Persist an upload's bytes to SharePoint when ROPC env is wired,
// or fall back to an inline marker (bytes not retained) otherwise.
// `folderSegment` is the per-tenant subfolder — a clientId for
// bound uploads, "__orphan__" for the wizard's pre-client uploads.
// On SharePoint failure, mutates `result.issues` so the caller's
// status downgrades to NEEDS_REVIEW without throwing.
async function persistUploadBytes(
  tenantId: string,
  filename: string,
  buffer: Buffer,
  folderSegment: string,
  result: ParseResult,
): Promise<{ storageKey: string; webUrl: string | null }> {
  if (!isSharePointConfigured()) {
    return { storageKey: `inline:pending-${Date.now()}`, webUrl: null };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  if (!tenant) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Tenant slug missing — cannot resolve SharePoint folder.',
    });
  }
  // Filename: timestamped + sanitised so a re-upload of the same
  // source file doesn't collide and audit history survives.
  const safeName =
    filename
      .replace(/[/\\]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/[^\w.\-() ]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 200)
      .trim() || 'placement-slip.xlsx';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalName = `${stamp}__${safeName}`;
  const folder = placementSlipFolder(tenant.slug, folderSegment);
  try {
    await ensureFolder(folder);
    const uploaded = await uploadToSharePoint(folder, finalName, buffer);
    return { storageKey: `sharepoint:${uploaded.path}`, webUrl: uploaded.webUrl };
  } catch (err) {
    console.error('[placement-slips] SharePoint upload failed:', err);
    result.issues.push({
      severity: 'warning',
      code: 'SHAREPOINT_UPLOAD_FAILED',
      message:
        'SharePoint upload failed. Re-parse will require re-upload (file bytes were not retained).',
    });
    if (result.status === 'PARSED') result.status = 'NEEDS_REVIEW';
    return { storageKey: `inline:pending-${Date.now()}`, webUrl: null };
  }
}

async function loadCatalogueParsingRules(db: TenantDb) {
  const types = await db.productType.findMany({
    select: { code: true, parsingRules: true },
  });
  return types
    .map((t) => ({
      productTypeCode: t.code,
      rules:
        t.parsingRules && typeof t.parsingRules === 'object' && !Array.isArray(t.parsingRules)
          ? ((t.parsingRules as { templates?: Record<string, ParsingRules> }).templates ?? {})
          : {},
    }))
    .filter((c) => Object.keys(c.rules).length > 0);
}

export const placementSlipsRouter = router({
  listByClient: tenantProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      return ctx.db.placementSlipUpload.findMany({
        where: { clientId: input.clientId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          filename: true,
          insurerTemplate: true,
          parseStatus: true,
          uploadedBy: true,
          createdAt: true,
          issues: true,
          // storageKey lets the UI tell SharePoint-backed uploads
          // (which can be re-parsed) from inline-fallback uploads.
          storageKey: true,
          storageWebUrl: true,
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    return loadUploadForTenant(ctx.db, input.id);
  }),

  upload: adminProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        filename: z.string().trim().min(1).max(200),
        // base64-encoded file body. Realistic placement slips are
        // <2 MB, so the JSON-RPC overhead is acceptable.
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);

      const buffer = Buffer.from(input.contentBase64, 'base64');
      assertExcelBuffer(buffer);

      const catalogueRules = await loadCatalogueParsingRules(ctx.db);
      let result: ParseResult;
      try {
        result = await parsePlacementSlip(buffer, catalogueRules);
      } catch (err) {
        result = {
          status: 'FAILED',
          detectedTemplate: null,
          products: [],
          policyEntities: [],
          benefitGroups: [],
          issues: [
            {
              severity: 'error',
              code: 'PARSER_THREW',
              message: err instanceof Error ? err.message : 'Parser threw an unexpected error.',
            },
          ],
        };
      }

      const { storageKey, webUrl } = await persistUploadBytes(
        ctx.tenantId,
        input.filename,
        buffer,
        input.clientId,
        result,
      );

      // The Prisma extension auto-injects tenantId on tenant-scoped
      // create/update; the empty-string here satisfies the static
      // Prisma type and is overwritten before the SQL is sent
      // (same trick as audit.ts).
      const upload = await ctx.db.placementSlipUpload.create({
        data: {
          tenantId: '',
          clientId: input.clientId,
          uploadedBy: ctx.userId,
          filename: input.filename,
          storageKey,
          storageWebUrl: webUrl,
          insurerTemplate: result.detectedTemplate,
          parseStatus: result.status,
          parseResult: result as unknown as Prisma.InputJsonValue,
          issues: result.issues as unknown as Prisma.InputJsonValue,
        },
      });
      // For inline fallback, normalise the storageKey to include the row id.
      if (storageKey.startsWith('inline:pending-')) {
        await ctx.db.placementSlipUpload.update({
          where: { id: upload.id },
          data: { storageKey: `inline:${upload.id}` },
        });
      }
      return { id: upload.id, webUrl, ...result };
    }),

  // Wizard entry point — accept a slip on /admin/clients/new before
  // any client exists. Stores the bytes under a tenant-only SharePoint
  // path; clientId is back-filled by the wizard's Apply step. Returns
  // just the upload id so the caller can route to the wizard URL —
  // the synchronous parse/extract pipeline runs server-side and the
  // wizard polls for status.
  uploadOrphan: adminProcedure
    .input(
      z.object({
        filename: z.string().trim().min(1).max(200),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.contentBase64, 'base64');
      assertExcelBuffer(buffer);

      // Run the full extractor: heuristic parse → envelope → suggestions.
      // When TenantAiProvider is configured the extractor's LLM stage
      // also enriches confidence, but the contract returned here is
      // identical either way.
      let extraction: Awaited<ReturnType<typeof extractFromWorkbook>>;
      try {
        extraction = await extractFromWorkbook(ctx.db, buffer);
      } catch (err) {
        extraction = {
          parseResult: {
            status: 'FAILED',
            detectedTemplate: null,
            products: [],
            policyEntities: [],
            benefitGroups: [],
            issues: [
              {
                severity: 'error',
                code: 'PARSER_THREW',
                message: err instanceof Error ? err.message : 'Parser threw an unexpected error.',
              },
            ],
          },
          extractedProducts: [],
          suggestions: {
            benefitGroups: [],
            eligibilityMatrix: [],
            missingPredicateFields: [],
            reconciliation: {
              perProduct: [],
              grandComputed: 0,
              grandDeclared: null,
              grandVariancePct: null,
            },
          },
        };
      }
      const result = extraction.parseResult;

      // Folder is tenant-only — wizard re-binds the upload to a
      // client folder (or copies, depending on storage policy) on Apply.
      const { storageKey, webUrl } = await persistUploadBytes(
        ctx.tenantId,
        input.filename,
        buffer,
        '__orphan__',
        result,
      );

      // ctx.db auto-stamps tenantId (empty-string satisfies the
      // static Prisma type); clientId stays null for the orphan path
      // until the wizard's Apply step binds it.
      const upload = await ctx.db.placementSlipUpload.create({
        data: {
          tenantId: '',
          clientId: null,
          uploadedBy: ctx.userId,
          filename: input.filename,
          storageKey,
          storageWebUrl: webUrl,
          insurerTemplate: result.detectedTemplate,
          parseStatus: result.status,
          parseResult: result as unknown as Prisma.InputJsonValue,
          issues: result.issues as unknown as Prisma.InputJsonValue,
        },
      });
      if (storageKey.startsWith('inline:pending-')) {
        await ctx.db.placementSlipUpload.update({
          where: { id: upload.id },
          data: { storageKey: `inline:${upload.id}` },
        });
      }

      // The extraction draft row is the wizard's working surface.
      // Hard cap on the JSONB payload — a malformed workbook with
      // thousands of rate rows could otherwise inflate this past
      // Postgres's per-row limits.
      const extractedJson = JSON.stringify(extraction.extractedProducts);
      if (extractedJson.length > 4 * 1024 * 1024) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Extracted product payload exceeds 4 MB; check the slip for malformed data.',
        });
      }
      await ctx.db.extractionDraft.create({
        data: {
          tenantId: '', // overwritten by the tenant extension
          uploadId: upload.id,
          status: 'READY',
          progress: {
            stage: extraction.extractedProducts.length > 0 ? 'COMPLETE' : 'HEURISTIC_ONLY',
            totalProducts: extraction.extractedProducts.length,
            completed: extraction.extractedProducts.length,
            suggestions: extraction.suggestions,
          } as unknown as Prisma.InputJsonValue,
          extractedProducts: extraction.extractedProducts as unknown as Prisma.InputJsonValue,
        },
      });

      return { id: upload.id, webUrl };
    }),

  // S29 (storage): re-parse an existing upload by fetching the bytes
  // back from SharePoint and running the parser again. Only works
  // when storageKey starts with "sharepoint:" — inline fallback uploads
  // can't be re-parsed because we never kept the bytes.
  reparse: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, input.id);
      if (!upload.storageKey.startsWith('sharepoint:')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Re-parse needs a SharePoint-backed upload. Inline-fallback uploads must be re-uploaded.',
        });
      }
      const path = upload.storageKey.replace(/^sharepoint:/, '');
      const buffer = await downloadFromSharePoint(path);
      const catalogueRules = await loadCatalogueParsingRules(ctx.db);
      const result = await parsePlacementSlip(buffer, catalogueRules);
      return ctx.db.placementSlipUpload.update({
        where: { id: input.id },
        data: {
          insurerTemplate: result.detectedTemplate,
          parseStatus: result.status,
          parseResult: result as unknown as Prisma.InputJsonValue,
          issues: result.issues as unknown as Prisma.InputJsonValue,
        },
      });
    }),

  // S32: mark resolved issues so the review UI tracks progress. Keeps
  // the upload row in NEEDS_REVIEW until every blocker is resolved.
  resolveIssue: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        issueIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, input.id);
      const issues = (upload.issues as { resolved?: boolean }[] | null) ?? [];
      const target = issues[input.issueIndex];
      if (!target) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Issue index out of range.' });
      }
      target.resolved = true;
      const allResolved = issues.every((i) => i.resolved === true);
      const newStatus = allResolved
        ? 'PARSED'
        : upload.parseStatus === 'FAILED'
          ? 'FAILED'
          : 'NEEDS_REVIEW';
      return ctx.db.placementSlipUpload.update({
        where: { id: input.id },
        data: {
          issues: issues as unknown as Prisma.InputJsonValue,
          parseStatus: newStatus,
        },
      });
    }),

  // S32 (apply): create real PolicyEntity/Product/Plan rows from a
  // parse result. Procedure name is `applyToCatalogue` because tRPC
  // reserves `apply` as a meta-method on routers.
  //
  // The heavy lifting lives in `server/ingestion/apply/orchestrator.ts`.
  // This handler validates preconditions and resolves the target
  // benefitYear; the orchestrator owns the transaction.
  applyToCatalogue: adminProcedure
    .input(z.object({ id: z.string().min(1), benefitYearId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, input.id);
      if (upload.parseStatus !== 'PARSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Resolve every parse issue before applying to the catalogue.',
        });
      }

      // applyToCatalogue is only meaningful on bound uploads — orphan
      // uploads run through extractionDrafts.applyToCatalogue, which
      // creates the Client + Policy as part of its own transaction.
      if (!upload.clientId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Upload is not bound to a client. Apply via the create-client wizard instead.',
        });
      }
      const uploadClientId = upload.clientId;

      // Resolve target benefit year + tenant gate via parent join.
      const benefitYear = await prisma.benefitYear.findFirst({
        where: {
          id: input.benefitYearId,
          policy: { client: { tenantId: ctx.tenantId, id: uploadClientId } },
        },
        include: { policy: true },
      });
      if (!benefitYear) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Benefit year not found on this client.',
        });
      }
      if (benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Benefit year is ${benefitYear.state}; can only apply to a DRAFT.`,
        });
      }

      const parseResult = upload.parseResult as ParseResult | null;
      if (!parseResult || parseResult.status !== 'PARSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Stored parse result is missing or not in PARSED state.',
        });
      }

      const { summary } = await applyParsedToCatalogue({
        db: ctx.db,
        parseResult,
        uploadId: input.id,
        benefitYearId: input.benefitYearId,
        policyId: benefitYear.policy.id,
      });

      // Re-read the upload so the response carries the post-tx state.
      const updated = await ctx.db.placementSlipUpload.findFirst({
        where: { id: input.id },
      });

      return { upload: updated, summary };
    }),

  // Delete an upload row. SharePoint cleanup is best-effort — a
  // missing remote file shouldn't block the DB delete.
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, input.id);
      if (upload.storageKey.startsWith('sharepoint:') && isSharePointConfigured()) {
        const path = upload.storageKey.replace(/^sharepoint:/, '');
        try {
          await deleteFromSharePoint(path);
        } catch (err) {
          // Log but don't fail — the row delete is the user's intent.
          console.warn(
            `[placement-slips] SharePoint delete failed for ${path}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      await ctx.db.placementSlipUpload.delete({ where: { id: input.id } });
      return { id: input.id };
    }),
});
