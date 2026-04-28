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
import { adminProcedure, router, tenantProcedure } from '../init';

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
      // Magic-byte sniff: accept both .xlsx (ZIP signature PK\x03\x04)
      // and .xls (CFB / OLE2 signature D0 CF 11 E0 A1 B1 1A E1). Reject
      // early before the parser allocates state on a non-Excel file.
      // The .xls path normalises to .xlsx in-memory inside parser.ts
      // via xls-to-xlsx.ts.
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

      const catalogueRules = await loadCatalogueParsingRules(ctx.tenantId);
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
          // Detail goes server-side; client gets a generic message.
          console.error('[placement-slips] SharePoint upload failed:', err);
          result.issues.push({
            severity: 'warning',
            code: 'SHAREPOINT_UPLOAD_FAILED',
            message:
              'SharePoint upload failed. Re-parse will require re-upload (file bytes were not retained).',
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
  reparse: adminProcedure
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
  resolveIssue: adminProcedure
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
      const upload = await loadUploadForTenant(ctx.tenantId, input.id);
      if (upload.parseStatus !== 'PARSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Resolve every parse issue before applying to the catalogue.',
        });
      }

      // Resolve target benefit year + tenant gate via parent join.
      const benefitYear = await prisma.benefitYear.findFirst({
        where: {
          id: input.benefitYearId,
          policy: { client: { tenantId: ctx.tenantId, id: upload.clientId } },
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

      // ── PolicyEntities ────────────────────────────────────────
      // Upsert keyed by (policyId, policyNumber). The unique index in
      // the Prisma schema (`@@unique([policyId, policyNumber])`) makes
      // this idempotent.
      let policyEntitiesUpserted = 0;
      for (const entity of parseResult.policyEntities ?? []) {
        await prisma.policyEntity.upsert({
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

      // ── Products + Plans ─────────────────────────────────────
      // Resolve insurer + product type once, upsert Product, then
      // create plans. stacksOn resolution happens in a second pass
      // after all plans exist.
      const insurerCache = new Map<string, string>(); // code → id
      const productTypeCache = new Map<
        string,
        { id: string; planSchema: unknown; premiumStrategy: string }
      >();

      let productsUpserted = 0;
      let plansCreated = 0;
      let stacksOnResolved = 0;
      const skipped: { reason: string; detail: string }[] = [];

      for (const parsed of parseResult.products) {
        // Resolve Insurer (e.g. "GE_LIFE" → tenant's insurer with that code).
        let insurerId = insurerCache.get(parsed.templateInsurerCode);
        if (!insurerId) {
          const insurer = await prisma.insurer.findFirst({
            where: { tenantId: ctx.tenantId, code: parsed.templateInsurerCode },
            select: { id: true },
          });
          if (!insurer) {
            skipped.push({
              reason: 'INSURER_NOT_FOUND',
              detail: `${parsed.productTypeCode}: insurer "${parsed.templateInsurerCode}" not in registry. Add it via /admin/catalogue/insurers and re-apply.`,
            });
            continue;
          }
          insurerId = insurer.id;
          insurerCache.set(parsed.templateInsurerCode, insurerId);
        }

        // Resolve ProductType.
        let productType = productTypeCache.get(parsed.productTypeCode);
        if (!productType) {
          const pt = await prisma.productType.findFirst({
            where: { tenantId: ctx.tenantId, code: parsed.productTypeCode },
            select: { id: true, planSchema: true, premiumStrategy: true },
          });
          if (!pt) {
            skipped.push({
              reason: 'PRODUCT_TYPE_NOT_FOUND',
              detail: `Product type ${parsed.productTypeCode} missing from catalogue.`,
            });
            continue;
          }
          productType = pt;
          productTypeCache.set(parsed.productTypeCode, productType);
        }

        // Pool resolution from parsed pool_name (best-effort).
        const poolName = String(parsed.fields.pool_name ?? '').trim();
        let poolId: string | null = null;
        if (poolName && poolName !== 'NA' && poolName !== 'N.A') {
          const pool = await prisma.pool.findFirst({
            where: { tenantId: ctx.tenantId, name: poolName },
            select: { id: true },
          });
          poolId = pool?.id ?? null;
        }

        // Product.data: minimum viable shape that passes ProductType.schema.
        // Real fields fill in from parsed.fields where keys align.
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
        const existing = await prisma.product.findFirst({
          where: { benefitYearId: input.benefitYearId, productTypeId: productType.id },
          select: { id: true },
        });
        const product = existing
          ? await prisma.product.update({
              where: { id: existing.id },
              data: { insurerId, poolId, data: productData as Prisma.InputJsonValue },
            })
          : await prisma.product.create({
              data: {
                benefitYearId: input.benefitYearId,
                productTypeId: productType.id,
                insurerId,
                poolId,
                data: productData as Prisma.InputJsonValue,
              },
            });
        productsUpserted += 1;

        // Plans — derive a short code from the parsed label.
        // "Plan A: …"      → "PA"
        // "1"              → "P1"
        // anything else    → "P<idx>"
        const coverBasisByStrategy: Record<string, string> = {
          per_individual_salary_multiple: 'salary_multiple',
          per_individual_fixed_sum: 'fixed_amount',
          per_group_cover_tier: 'per_cover_tier',
          per_headcount_flat: 'fixed_amount',
          per_individual_earnings: 'fixed_amount',
        };
        const coverBasis = coverBasisByStrategy[productType.premiumStrategy] ?? 'fixed_amount';

        // labelToCode is local so re-apply produces stable codes.
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

          // schedule = {} works for products whose planSchema has no
          // required fields. Where required fields exist, the broker
          // fills them in via the per-product UI (S22). The Ajv-strict
          // path is in the per-plan tRPC update; the seed createMany
          // bypass here is intentional and surfaced in skipped[].
          await prisma.plan.upsert({
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

        // Second pass: resolve stacksOn now that all plans for this
        // product exist. "additional above Plan A" → match the plan
        // labelled "Plan A:…" → use its derived code as stacksOn FK.
        for (const plan of parsed.plans) {
          if (!plan.stacksOnLabel) continue;
          const baseLabelMatch = parsed.plans.find((p) =>
            p.code.toLowerCase().startsWith(plan.stacksOnLabel?.toLowerCase() ?? '__never__'),
          );
          if (!baseLabelMatch) continue;
          const childCode = labelToCode.get(plan.code);
          const baseCode = labelToCode.get(baseLabelMatch.code);
          if (!childCode || !baseCode) continue;
          const baseRow = await prisma.plan.findUnique({
            where: { productId_code: { productId: product.id, code: baseCode } },
            select: { id: true },
          });
          if (!baseRow) continue;
          await prisma.plan.update({
            where: { productId_code: { productId: product.id, code: childCode } },
            data: { stacksOn: baseRow.id },
          });
          stacksOnResolved += 1;
        }
      }

      // ── PremiumRate creation ─────────────────────────────────
      // Walk each parsed product's rate rows per its rate_column_map
      // and emit PremiumRate rows. Idempotent via deleteMany on the
      // product before recreating — re-applying the same payload
      // produces the same set, no dupes.
      let premiumRatesCreated = 0;
      for (const parsed of parseResult.products) {
        const insurerId = insurerCache.get(parsed.templateInsurerCode);
        const productType = productTypeCache.get(parsed.productTypeCode);
        if (!insurerId || !productType) continue;
        const product = await prisma.product.findFirst({
          where: { benefitYearId: input.benefitYearId, productTypeId: productType.id },
          select: { id: true },
        });
        if (!product) continue;

        // Find the rate_column_map for this product's matching rule.
        // Pull from the catalogue rather than the parsed payload — the
        // parser's `rates` rows don't carry the column map themselves.
        const productTypeRow = await prisma.productType.findUnique({
          where: { id: productType.id },
          select: { parsingRules: true },
        });
        const templates =
          (productTypeRow?.parsingRules as { templates?: Record<string, ParsingRules> } | null)
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

        // Look up plans by the same code-derivation logic the apply
        // step used so we can resolve a rate's plan label → planId.
        const allPlans = await prisma.plan.findMany({
          where: { productId: product.id },
          select: { id: true, code: true, name: true },
        });
        const planByLabel = new Map<string, string>();
        for (const p of allPlans) {
          // Match by name (full label) and by code; let either
          // resolve a rate row's plan reference.
          planByLabel.set(p.name.toLowerCase(), p.id);
          planByLabel.set(p.code.toLowerCase(), p.id);
        }

        const colIndex = (letter: string) => letter.toUpperCase().charCodeAt(0) - 64;
        const planMatchKey = `col${colIndex(map.planMatch)}`;

        // Wipe + rebuild so re-apply is deterministic.
        await prisma.premiumRate.deleteMany({ where: { productId: product.id } });

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
          // Match "Plan A: …" → "plan a:" or just "1" → "1".
          let planId: string | undefined;
          for (const [k, v] of planByLabel) {
            if (k.startsWith(labelStr) || labelStr.startsWith(k)) {
              planId = v;
              break;
            }
          }
          if (!planId) continue;

          if (map.tiers && map.tiers.length > 0) {
            // per_cover_tier: one PremiumRate per (plan, tier).
            for (const t of map.tiers) {
              const cell = rateRow[`col${colIndex(t.rateColumn)}`];
              const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
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
            const cell = rateRow[`col${colIndex(map.ratePerThousand)}`];
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
            const cell = rateRow[`col${colIndex(map.fixedAmount)}`];
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
          await prisma.premiumRate.createMany({ data: ratesToCreate });
          premiumRatesCreated += ratesToCreate.length;
        }
      }

      if ((parseResult.benefitGroups?.length ?? 0) > 0) {
        skipped.push({
          reason: 'BENEFIT_GROUPS_DEFERRED',
          detail: `${parseResult.benefitGroups.length} predicate suggestions surfaced — confirm in the Benefit Groups screen, not auto-saved.`,
        });
      }

      const updated = await prisma.placementSlipUpload.update({
        where: { id: input.id },
        data: { parseStatus: 'APPLIED' },
      });

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
