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
// =============================================================

import { prisma } from '@/server/db/client';
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
import { router, tenantProcedure } from '../init';

async function assertClient(tenantId: string, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  });
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
  }
}

// PlacementSlipUpload has no `client` relation in the schema (just a
// String FK on `clientId`), so tenant-gating happens in two steps.
async function loadUploadForTenant(tenantId: string, uploadId: string) {
  const upload = await prisma.placementSlipUpload.findUnique({ where: { id: uploadId } });
  if (!upload) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found.' });
  }
  await assertClient(tenantId, upload.clientId);
  return upload;
}

async function loadCatalogueParsingRules(tenantId: string) {
  const types = await prisma.productType.findMany({
    where: { tenantId },
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
      await assertClient(ctx.tenantId, input.clientId);
      return prisma.placementSlipUpload.findMany({
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
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const upload = await loadUploadForTenant(ctx.tenantId, input.id);
    return upload;
  }),

  upload: tenantProcedure
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
      await assertClient(ctx.tenantId, input.clientId);

      const buffer = Buffer.from(input.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty file.' });
      }
      if (buffer.length > 25 * 1024 * 1024) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'File exceeds 25 MB limit.',
        });
      }

      const catalogueRules = await loadCatalogueParsingRules(ctx.tenantId);
      let result: ParseResult;
      try {
        result = await parsePlacementSlip(buffer, catalogueRules);
      } catch (err) {
        result = {
          status: 'FAILED',
          detectedTemplate: null,
          products: [],
          issues: [
            {
              severity: 'error',
              code: 'PARSER_THREW',
              message: err instanceof Error ? err.message : 'Parser threw an unexpected error.',
            },
          ],
        };
      }

      // Upload to SharePoint when ROPC env is configured. Otherwise
      // fall back to the inline marker for local dev — the file
      // bytes aren't retained then, so re-parse requires re-upload.
      let storageKey = '';
      let webUrl: string | null = null;
      if (isSharePointConfigured()) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { slug: true },
        });
        if (!tenant) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Tenant slug missing — cannot resolve SharePoint folder.',
          });
        }
        // Filename: timestamped + sanitised so a re-upload of the
        // same source file doesn't collide and audit history survives.
        const safeName =
          input.filename
            .replace(/[/\\]/g, '_')
            .replace(/\.\./g, '_')
            .replace(/[^\w.\-() ]/g, '_')
            .replace(/^\.+/, '')
            .slice(0, 200)
            .trim() || 'placement-slip.xlsx';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalName = `${stamp}__${safeName}`;
        const folder = placementSlipFolder(tenant.slug, input.clientId);
        try {
          await ensureFolder(folder);
          const uploaded = await uploadToSharePoint(folder, finalName, buffer);
          storageKey = `sharepoint:${uploaded.path}`;
          webUrl = uploaded.webUrl;
        } catch (err) {
          // SharePoint failure shouldn't drop the parse work — record
          // it as a NEEDS_REVIEW issue and keep the parsed payload.
          result.issues.push({
            severity: 'warning',
            code: 'SHAREPOINT_UPLOAD_FAILED',
            message: `SharePoint upload failed: ${err instanceof Error ? err.message : 'unknown'}. Re-parse will require re-upload.`,
          });
          if (result.status === 'PARSED') result.status = 'NEEDS_REVIEW';
          storageKey = `inline:pending-${Date.now()}`;
        }
      } else {
        // Dev / local fallback — bytes aren't persisted.
        storageKey = `inline:pending-${Date.now()}`;
      }

      const upload = await prisma.placementSlipUpload.create({
        data: {
          clientId: input.clientId,
          uploadedBy: ctx.userId,
          filename: input.filename,
          storageKey,
          insurerTemplate: result.detectedTemplate,
          parseStatus: result.status,
          parseResult: result as unknown as Prisma.InputJsonValue,
          issues: result.issues as unknown as Prisma.InputJsonValue,
        },
      });
      // For inline fallback, normalise the storageKey to include the row id.
      if (storageKey.startsWith('inline:pending-')) {
        await prisma.placementSlipUpload.update({
          where: { id: upload.id },
          data: { storageKey: `inline:${upload.id}` },
        });
      }
      return { id: upload.id, webUrl, ...result };
    }),

  // S29 (storage): re-parse an existing upload by fetching the bytes
  // back from SharePoint and running the parser again. Only works
  // when storageKey starts with "sharepoint:" — inline fallback uploads
  // can't be re-parsed because we never kept the bytes.
  reparse: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.tenantId, input.id);
      if (!upload.storageKey.startsWith('sharepoint:')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Re-parse needs a SharePoint-backed upload. Inline-fallback uploads must be re-uploaded.',
        });
      }
      const path = upload.storageKey.replace(/^sharepoint:/, '');
      const buffer = await downloadFromSharePoint(path);
      const catalogueRules = await loadCatalogueParsingRules(ctx.tenantId);
      const result = await parsePlacementSlip(buffer, catalogueRules);
      return prisma.placementSlipUpload.update({
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
  resolveIssue: tenantProcedure
    .input(
      z.object({
        id: z.string().min(1),
        issueIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.tenantId, input.id);
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
      return prisma.placementSlipUpload.update({
        where: { id: input.id },
        data: {
          issues: issues as unknown as Prisma.InputJsonValue,
          parseStatus: newStatus,
        },
      });
    }),

  // S32 (apply): create real Product/Plan/PremiumRate rows from a
  // parse result. Phase 1G ships this as a stub that flips the
  // status — full row mapping lands once real placement-slip output
  // is available to QA. Procedure name is `applyToCatalogue` because
  // tRPC reserves `apply` as a meta-method on routers.
  applyToCatalogue: tenantProcedure
    .input(z.object({ id: z.string().min(1), benefitYearId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.tenantId, input.id);
      if (upload.parseStatus !== 'PARSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Resolve every parse issue before applying to the catalogue.',
        });
      }
      // Mark applied; full row creation deferred to a follow-up PR
      // when reference placement slips are available for QA.
      return prisma.placementSlipUpload.update({
        where: { id: input.id },
        data: { parseStatus: 'APPLIED' },
      });
    }),

  // Delete an upload row. SharePoint cleanup is best-effort — a
  // missing remote file shouldn't block the DB delete.
  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.tenantId, input.id);
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
      await prisma.placementSlipUpload.delete({ where: { id: input.id } });
      return { id: input.id };
    }),
});
