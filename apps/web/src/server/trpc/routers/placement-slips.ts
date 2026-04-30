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

import { safeCompile } from '@/server/catalogue/ajv';
import { COVER_BASIS_BY_STRATEGY, excelColumnIndex } from '@/server/catalogue/premium-strategy';
import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import { extractFromWorkbook } from '@/server/extraction/extractor';
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

// Use the tenant-scoped client (`ctx.db`) for all TENANT_MODELS lookups
// — the Prisma extension in db/tenant.ts auto-injects the tenantId
// filter so a regression here can't cross tenants. The bare `prisma`
// import is reserved for non-tenant-scoped models (PlacementSlipUpload,
// Plan, PremiumRate, etc., which gate via their parent Client lookup).

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
//   orphan upload — clientId is null; verify upload.tenantId matches ctx
// The direct tenantId column was added in 20260430140000 to make orphan
// uploads possible (the wizard creates them on /admin/clients/new
// before any client exists).
async function loadUploadForTenant(db: TenantDb, tenantId: string, uploadId: string) {
  const upload = await prisma.placementSlipUpload.findUnique({ where: { id: uploadId } });
  if (!upload) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found.' });
  }
  if (upload.tenantId !== tenantId) {
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
          storageWebUrl: true,
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const upload = await loadUploadForTenant(ctx.db, ctx.tenantId, input.id);
    return upload;
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

      // tenantId is required at the column level (added in
      // 20260430140000_wizard_foundation). Bare `prisma.placementSlipUpload.create`
      // doesn't auto-inject it; pass explicitly. The wizard's orphan-upload path
      // uses the same column with clientId omitted.
      const upload = await prisma.placementSlipUpload.create({
        data: {
          tenantId: ctx.tenantId,
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
        await prisma.placementSlipUpload.update({
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

      const upload = await prisma.placementSlipUpload.create({
        data: {
          tenantId: ctx.tenantId,
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
        await prisma.placementSlipUpload.update({
          where: { id: upload.id },
          data: { storageKey: `inline:${upload.id}` },
        });
      }

      // The extraction draft row is the wizard's working surface.
      // We persist the envelope-shaped products plus the suggestions
      // blob (predicates, eligibility matrix, missing fields,
      // reconciliation) so every section reads from one place.
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
      await prisma.extractionDraft.create({
        data: {
          tenantId: ctx.tenantId,
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
      const upload = await loadUploadForTenant(ctx.db, ctx.tenantId, input.id);
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
  resolveIssue: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        issueIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, ctx.tenantId, input.id);
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

  // S32 (apply): create real PolicyEntity/Product/Plan rows from a
  // parse result. Procedure name is `applyToCatalogue` because tRPC
  // reserves `apply` as a meta-method on routers.
  //
  // Phase 1G scope:
  //   ✅ PolicyEntity upsert from result.policyEntities
  //   ✅ Product upsert per parsed product (insurer + policy_number)
  //   ✅ Plan creation with placeholder schedule + stacksOn resolution
  //   ⏳ PremiumRate: defers — column→schedule mapping is per-insurer
  //      calibration the broker tunes once per insurer template.
  //   ⏳ BenefitGroup: stays broker-confirmed in the review UI;
  //      result.benefitGroups carries predicate suggestions only.
  //
  // Idempotent: re-applying upserts on (policyId, policyNumber) and
  // (productId, code), so the same payload twice produces no dupes.
  applyToCatalogue: adminProcedure
    .input(z.object({ id: z.string().min(1), benefitYearId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, ctx.tenantId, input.id);
      if (upload.parseStatus !== 'PARSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Resolve every parse issue before applying to the catalogue.',
        });
      }

      // applyToCatalogue is only meaningful on bound uploads — orphan
      // uploads run through extractionDrafts.applyToCatalogue, which
      // creates the Client + Policy as part of its own transaction.
      // Guard here keeps TypeScript happy now that clientId is nullable.
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

      // Pre-resolve catalogue rows used inside the transaction. The
      // tenant-scoped extension (`ctx.db`) auto-injects tenantId on
      // these reads; doing them upfront keeps the transaction body
      // focused on writes and means a missing-FK diagnostic surfaces
      // before we open a transaction.
      const insurerCache = new Map<string, string>(); // code → id
      const productTypeCache = new Map<
        string,
        {
          id: string;
          planSchema: unknown;
          premiumStrategy: string;
          parsingRules: unknown;
        }
      >();
      const skipped: { reason: string; detail: string }[] = [];

      for (const parsed of parseResult.products) {
        if (!insurerCache.has(parsed.templateInsurerCode)) {
          const insurer = await ctx.db.insurer.findFirst({
            where: { code: parsed.templateInsurerCode },
            select: { id: true },
          });
          if (!insurer) {
            skipped.push({
              reason: 'INSURER_NOT_FOUND',
              detail: `${parsed.productTypeCode}: insurer "${parsed.templateInsurerCode}" not in registry. Add it via /admin/catalogue/insurers and re-apply.`,
            });
            continue;
          }
          insurerCache.set(parsed.templateInsurerCode, insurer.id);
        }
        if (!productTypeCache.has(parsed.productTypeCode)) {
          const pt = await ctx.db.productType.findFirst({
            where: { code: parsed.productTypeCode },
            select: { id: true, planSchema: true, premiumStrategy: true, parsingRules: true },
          });
          if (!pt) {
            skipped.push({
              reason: 'PRODUCT_TYPE_NOT_FOUND',
              detail: `Product type ${parsed.productTypeCode} missing from catalogue.`,
            });
            continue;
          }
          productTypeCache.set(parsed.productTypeCode, pt);
        }
      }

      // ── Atomic write — H1 ─────────────────────────────────────
      // Wrap every write in a single $transaction so a mid-flight
      // failure rolls back PolicyEntity / Product / Plan / PremiumRate
      // changes together. Without this, a crash between Plan upsert
      // and PremiumRate.createMany leaves the catalogue half-written.
      // The 60s timeout covers a worst-case STM-class slip (7 products,
      // ~30 plans, 60+ rate rows) on a cold connection pool; smaller
      // slips finish in <1s.
      const txResult = await prisma.$transaction(
        async (tx) => {
          let policyEntitiesUpserted = 0;
          let productsUpserted = 0;
          let plansCreated = 0;
          let stacksOnResolved = 0;
          let premiumRatesCreated = 0;

          // ── PolicyEntities ─────────────────────────────────────
          for (const entity of parseResult.policyEntities ?? []) {
            await tx.policyEntity.upsert({
              where: {
                policyId_policyNumber: {
                  policyId: benefitYear.policy.id,
                  policyNumber: entity.policyNumber,
                },
              },
              update: {
                legalName: entity.legalName,
                isMaster: entity.isMaster,
              },
              create: {
                policyId: benefitYear.policy.id,
                policyNumber: entity.policyNumber,
                legalName: entity.legalName,
                isMaster: entity.isMaster,
              },
            });
            policyEntitiesUpserted += 1;
          }

          // ── Products + Plans ───────────────────────────────────
          for (const parsed of parseResult.products) {
            const insurerId = insurerCache.get(parsed.templateInsurerCode);
            const productType = productTypeCache.get(parsed.productTypeCode);
            if (!insurerId || !productType) continue; // already in skipped[]

            // Pool resolution from parsed pool_name (best-effort). Pool
            // is a TENANT_MODEL — `ctx.db` auto-scopes it; the read is
            // outside the tx but reads inside Prisma's pool are fine.
            const poolName = String(parsed.fields.pool_name ?? '').trim();
            let poolId: string | null = null;
            if (poolName && poolName !== 'NA' && poolName !== 'N.A') {
              const pool = await tx.pool.findFirst({
                where: { name: poolName },
                select: { id: true },
              });
              poolId = pool?.id ?? null;
            }

            // Product.data: minimum viable shape that passes
            // ProductType.schema. Real fields fill in from
            // parsed.fields where keys align.
            const policyNumber =
              String(parsed.fields.policy_numbers_csv ?? parsed.fields.policy_number ?? '')
                .split(',')[0]
                ?.trim() ?? '';
            const productData: Record<string, unknown> = {
              insurer: parsed.templateInsurerCode,
              policy_number: policyNumber || 'PENDING',
              eligibility_text: parsed.fields.eligibility_text ?? undefined,
              benefit_period: parsed.fields.period_of_insurance ?? undefined,
            };

            // Upsert Product on (benefitYearId, productTypeId).
            const existing = await tx.product.findFirst({
              where: { benefitYearId: input.benefitYearId, productTypeId: productType.id },
              select: { id: true },
            });
            const product = existing
              ? await tx.product.update({
                  where: { id: existing.id },
                  data: { insurerId, poolId, data: productData as Prisma.InputJsonValue },
                })
              : await tx.product.create({
                  data: {
                    benefitYearId: input.benefitYearId,
                    productTypeId: productType.id,
                    insurerId,
                    poolId,
                    data: productData as Prisma.InputJsonValue,
                  },
                });
            productsUpserted += 1;

            // ── H2: Validate Plan.schedule against planSchema ──
            // Compile once per product type (cached across products
            // sharing a type within this apply call). Surface any
            // required-field violations in skipped[] with an
            // actionable message rather than silently writing
            // schedule={} that fails review.validate later.
            const compiled = safeCompile(
              productType.planSchema,
              `product-type:${productType.id}::planSchema-applyToCatalogue`,
            );

            // Plans — derive a short code from the parsed label.
            const coverBasis =
              COVER_BASIS_BY_STRATEGY[productType.premiumStrategy] ?? 'fixed_amount';

            const labelToCode = new Map<string, string>();
            for (let i = 0; i < parsed.plans.length; i++) {
              const plan = parsed.plans[i];
              if (!plan) continue;
              const planMatch = plan.code.match(/^Plan\s+([A-Z0-9]+)/i);
              const numberMatch = plan.code.match(/^(\d+)\b/);
              const code = planMatch
                ? `P${planMatch[1]?.toUpperCase()}`
                : numberMatch
                  ? `P${numberMatch[1]}`
                  : `P${i + 1}`;
              labelToCode.set(plan.code, code);

              // Validate the placeholder candidate against planSchema
              // so a broker knows up front when they'll need to fill
              // schedule via the Plans tab before publish.
              if (compiled.ok) {
                const candidate = {
                  code,
                  name: plan.code,
                  coverBasis,
                  stacksOn: null,
                  selectionMode: 'single',
                  schedule: {},
                  effectiveFrom: null,
                  effectiveTo: null,
                };
                if (!compiled.validate(candidate)) {
                  const fields = (compiled.validate.errors ?? [])
                    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
                    .filter((m) => m.length > 0)
                    .slice(0, 5)
                    .join(', ');
                  skipped.push({
                    reason: 'PLAN_SCHEDULE_NEEDS_BROKER_INPUT',
                    detail: `${parsed.productTypeCode} plan ${code}: required fields not on the slip — fill in via the Plans tab before publishing (${fields}).`,
                  });
                }
              }

              await tx.plan.upsert({
                where: { productId_code: { productId: product.id, code } },
                update: { name: plan.code, coverBasis },
                create: {
                  productId: product.id,
                  code,
                  name: plan.code,
                  coverBasis,
                  schedule: {} as Prisma.InputJsonValue,
                },
              });
              plansCreated += 1;
            }

            // Second pass: resolve stacksOn now that all plans exist.
            for (const plan of parsed.plans) {
              if (!plan.stacksOnLabel) continue;
              const baseLabelMatch = parsed.plans.find((p) =>
                p.code.toLowerCase().startsWith(plan.stacksOnLabel?.toLowerCase() ?? '__never__'),
              );
              if (!baseLabelMatch) continue;
              const childCode = labelToCode.get(plan.code);
              const baseCode = labelToCode.get(baseLabelMatch.code);
              if (!childCode || !baseCode) continue;
              const baseRow = await tx.plan.findUnique({
                where: { productId_code: { productId: product.id, code: baseCode } },
                select: { id: true },
              });
              if (!baseRow) continue;
              await tx.plan.update({
                where: { productId_code: { productId: product.id, code: childCode } },
                data: { stacksOn: baseRow.id },
              });
              stacksOnResolved += 1;
            }

            // ── PremiumRate creation (per product) ─────────────
            // Pull rate_column_map from the cached parsingRules
            // captured upfront — re-fetching ProductType in this
            // loop is a wasted round-trip (perf H1).
            const templates =
              (productType.parsingRules as { templates?: Record<string, ParsingRules> } | null)
                ?.templates ?? {};
            const rules = templates[parsed.templateInsurerCode];
            const map = rules?.rate_column_map;
            if (!map) {
              skipped.push({
                reason: 'NO_RATE_COLUMN_MAP',
                detail: `${parsed.productTypeCode} via ${parsed.templateInsurerCode}: parsingRules has no rate_column_map; rates can be entered via the Premium tab.`,
              });
              continue;
            }

            const allPlans = await tx.plan.findMany({
              where: { productId: product.id },
              select: { id: true, code: true, name: true },
            });
            const planByLabel = new Map<string, string>();
            for (const p of allPlans) {
              planByLabel.set(p.name.toLowerCase(), p.id);
              planByLabel.set(p.code.toLowerCase(), p.id);
            }

            const planMatchKey = `col${excelColumnIndex(map.planMatch)}`;

            // Wipe + rebuild so re-apply is deterministic.
            await tx.premiumRate.deleteMany({ where: { productId: product.id } });

            const ratesToCreate: {
              productId: string;
              planId: string;
              coverTier: string | null;
              ratePerThousand: number | null;
              fixedAmount: number | null;
            }[] = [];

            for (const rateRow of parsed.rates) {
              const rawLabel = rateRow[planMatchKey];
              if (!rawLabel) continue;
              const labelStr = String(rawLabel).trim().toLowerCase();
              let planId: string | undefined;
              for (const [k, v] of planByLabel) {
                if (k.startsWith(labelStr) || labelStr.startsWith(k)) {
                  planId = v;
                  break;
                }
              }
              if (!planId) continue;

              if (map.tiers && map.tiers.length > 0) {
                for (const t of map.tiers) {
                  const cell = rateRow[`col${excelColumnIndex(t.rateColumn)}`];
                  const num =
                    typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
                  if (!Number.isFinite(num) || num <= 0) continue;
                  ratesToCreate.push({
                    productId: product.id,
                    planId,
                    coverTier: t.tier,
                    ratePerThousand: null,
                    fixedAmount: num,
                  });
                }
              } else if (map.ratePerThousand) {
                const cell = rateRow[`col${excelColumnIndex(map.ratePerThousand)}`];
                const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
                if (Number.isFinite(num) && num > 0) {
                  ratesToCreate.push({
                    productId: product.id,
                    planId,
                    coverTier: null,
                    ratePerThousand: num,
                    fixedAmount: null,
                  });
                }
              } else if (map.fixedAmount) {
                const cell = rateRow[`col${excelColumnIndex(map.fixedAmount)}`];
                const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
                if (Number.isFinite(num) && num > 0) {
                  ratesToCreate.push({
                    productId: product.id,
                    planId,
                    coverTier: null,
                    ratePerThousand: null,
                    fixedAmount: num,
                  });
                }
              }
            }

            if (ratesToCreate.length > 0) {
              await tx.premiumRate.createMany({ data: ratesToCreate });
              premiumRatesCreated += ratesToCreate.length;
            }
          }

          if ((parseResult.benefitGroups?.length ?? 0) > 0) {
            skipped.push({
              reason: 'BENEFIT_GROUPS_DEFERRED',
              detail: `${parseResult.benefitGroups.length} predicate suggestions surfaced — confirm in the Benefit Groups screen, not auto-saved.`,
            });
          }

          const updated = await tx.placementSlipUpload.update({
            where: { id: input.id },
            data: { parseStatus: 'APPLIED' },
          });

          return {
            updated,
            policyEntitiesUpserted,
            productsUpserted,
            plansCreated,
            stacksOnResolved,
            premiumRatesCreated,
          };
        },
        { maxWait: 5_000, timeout: 60_000 },
      );

      const {
        updated,
        policyEntitiesUpserted,
        productsUpserted,
        plansCreated,
        stacksOnResolved,
        premiumRatesCreated,
      } = txResult;

      return {
        upload: updated,
        summary: {
          policyEntitiesUpserted,
          productsUpserted,
          plansCreated,
          stacksOnResolved,
          premiumRatesCreated,
          skipped,
        },
      };
    }),

  // Delete an upload row. SharePoint cleanup is best-effort — a
  // missing remote file shouldn't block the DB delete.
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await loadUploadForTenant(ctx.db, ctx.tenantId, input.id);
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
