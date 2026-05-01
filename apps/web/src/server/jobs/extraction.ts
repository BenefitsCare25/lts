// =============================================================
// AI extraction background job.
//
// Runs the heuristic parser + AI extractor for an ExtractionDraft
// off the request hot-path. The wizard polls byUploadId every 2s
// while status === 'EXTRACTING'; this job flips status to READY (or
// FAILED) when it completes.
//
// Lifecycle:
//   draft.status ← EXTRACTING (set by tRPC mutation before enqueue)
//      ↓
//   process(): heuristic parse → AI runner → merge → write
//      ↓
//   draft.status ← READY    (success)
//   draft.status ← FAILED   (validation error or non-retryable HTTP)
//
// On retryable failures (network, 5xx), the job throws and BullMQ
// retries with exponential backoff (configured on the queue). After
// final retry exhaustion, BullMQ's `failed` event fires; we hook
// that to flip the draft to FAILED so the wizard surfaces the error.
//
// Why we re-run the heuristic here instead of trusting the row's
// stored parseResult: parsing rules can change between upload time
// and AI extraction time (the broker may add a new insurer template
// in /admin/catalogue between uploading and clicking "Run AI
// extraction"). Re-running is cheap and keeps the floor fresh.
// =============================================================

import { prisma } from '@/server/db/client';
import { createTenantClient } from '@/server/db/tenant';
import { runAiExtraction } from '@/server/extraction/ai/runner';
import { type ExtractionResult, extractFromWorkbook } from '@/server/extraction/extractor';
import { downloadFile } from '@/server/storage/sharepoint';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { getDefaultQueue } from './queues';

export const AI_EXTRACTION_JOB = 'ai-extraction' as const;

export type AiExtractionJobData = {
  uploadId: string;
  // The tenantId is captured at enqueue time so the worker doesn't
  // have to derive it (and isn't tricked by a poisoned upload row).
  tenantId: string;
  // Captured at enqueue time so we can write a richer audit hint.
  enqueuedByUserId: string;
};

export async function enqueueAiExtraction(data: AiExtractionJobData): Promise<string> {
  const queue = getDefaultQueue();
  // Job ID == uploadId so re-enqueuing for the same upload is a
  // no-op while a job is in-flight (BullMQ refuses duplicate IDs by
  // default). After the job completes, removeOnComplete clears the
  // ID so a future re-run is allowed.
  const job = await queue.add(AI_EXTRACTION_JOB, data, {
    jobId: `extraction-${data.uploadId}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5_000 },
  });
  return job.id ?? `extraction-${data.uploadId}`;
}

export async function processAiExtraction(job: Job<AiExtractionJobData>): Promise<void> {
  const { uploadId, tenantId } = job.data;
  // biome-ignore lint/suspicious/noConsoleLog: intentional job lifecycle log
  console.log(`[ai-extraction] start uploadId=${uploadId} tenant=${tenantId}`);

  // Bind RLS for this connection. The tenant-extension already filters
  // by tenantId on tenant-scoped CRUD, but we set the GUC for any
  // findUnique paths and for defence-in-depth.
  await prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

  // Load the draft + upload from the bare client. We verified the
  // tenantId at enqueue time; re-verify here in case the row was
  // tampered with.
  const draft = await prisma.extractionDraft.findUnique({
    where: { uploadId },
    include: { upload: true },
  });
  if (!draft) {
    throw new Error(`ExtractionDraft not found for uploadId=${uploadId}`);
  }
  if (draft.tenantId !== tenantId) {
    throw new Error(
      `Tenant mismatch — draft.tenantId=${draft.tenantId} but job.tenantId=${tenantId}`,
    );
  }

  // Resolve the tenant slug — the AI prompt embeds it as a soft hint
  // and the catalogue context loader needs it to label the snapshot.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found.`);
  }

  const upload = draft.upload;
  if (!upload.storageKey.startsWith('sharepoint:')) {
    await markFailed(uploadId, {
      stage: 'STORAGE',
      message:
        'AI extraction needs the source workbook from SharePoint, but this upload was stored inline (SharePoint was unavailable when uploaded). Re-upload the slip to enable AI extraction.',
    });
    return;
  }

  let buffer: Buffer;
  try {
    const path = upload.storageKey.replace(/^sharepoint:/, '');
    buffer = await downloadFile(path);
  } catch (err) {
    // Storage outage — retryable. Throw so BullMQ retries.
    throw new Error(
      `Failed to download workbook from SharePoint: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  const db = createTenantClient(tenantId);

  // Run the heuristic baseline. It's cheap (50–500ms) and gives the
  // AI a floor of confidence-1.0 cells when an insurer template
  // actually matches.
  let heuristic: ExtractionResult;
  try {
    heuristic = await extractFromWorkbook(db, buffer);
  } catch (err) {
    // Heuristic failure is unusual — corrupt workbook, or a bug in
    // the parser. Don't block AI from trying; fall back to empty.
    console.error('[ai-extraction] heuristic failed:', err);
    heuristic = {
      parseResult: {
        status: 'FAILED',
        detectedTemplate: null,
        products: [],
        policyEntities: [],
        benefitGroups: [],
        issues: [
          {
            severity: 'warning',
            code: 'HEURISTIC_THREW',
            message: err instanceof Error ? err.message : 'Heuristic parser threw before AI ran.',
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

  await markProgress(uploadId, {
    stage: 'CALLING_AI',
    sheetsCount: undefined,
  });

  const aiResult = await runAiExtraction({
    db,
    tenantSlug: tenant.slug,
    workbookBuffer: buffer,
    heuristicProducts: heuristic.extractedProducts,
  });

  if (!aiResult.ok) {
    if (aiResult.retryable) {
      // Throwing causes BullMQ to retry per the queue's backoff config.
      throw new Error(`AI extraction failed (retryable): ${aiResult.error}`);
    }
    await markFailed(uploadId, {
      stage: 'AI_CALL',
      message: aiResult.error,
      meta: aiResult.meta,
    });
    return;
  }

  // Re-derive suggestions from the merged extraction so the wizard's
  // Eligibility / Schema-Additions / Reconciliation sections reflect
  // AI-discovered plan labels too. We piggyback on the extractor's
  // existing suggestion layer rather than reimplementing it.
  const refreshed = await rebuildSuggestionsForMerged(db, aiResult.products);

  const extractedJson = JSON.stringify(aiResult.products);
  if (extractedJson.length > 4 * 1024 * 1024) {
    await markFailed(uploadId, {
      stage: 'PERSIST',
      message:
        'AI-extracted product payload exceeds 4 MB. The workbook may have an unusually large rate matrix; check the slip for malformed data.',
    });
    return;
  }

  await prisma.extractionDraft.update({
    where: { id: draft.id },
    data: {
      status: 'READY',
      extractedProducts: aiResult.products as unknown as Prisma.InputJsonValue,
      progress: {
        stage: 'COMPLETE',
        totalProducts: aiResult.products.length,
        completed: aiResult.products.length,
        suggestions: refreshed,
        proposedClient: aiResult.proposedClient,
        proposedPolicyEntities: aiResult.proposedPolicyEntities,
        proposedBenefitYear: aiResult.proposedBenefitYear,
        proposedInsurers: aiResult.proposedInsurers,
        proposedPool: aiResult.proposedPool,
        warnings: aiResult.warnings,
        ai: {
          model: aiResult.meta.model,
          inputTokens: aiResult.meta.inputTokens,
          outputTokens: aiResult.meta.outputTokens,
          cacheReadTokens: aiResult.meta.cacheReadTokens,
          cacheCreationTokens: aiResult.meta.cacheCreationTokens,
          latencyMs: aiResult.meta.latencyMs,
          workbookChars: aiResult.meta.workbookChars,
          workbookTruncated: aiResult.meta.workbookTruncated,
          sheetsCount: aiResult.meta.sheetsCount,
          retried: aiResult.meta.retried,
          completedAt: new Date().toISOString(),
        },
      } as unknown as Prisma.InputJsonValue,
      // Prisma's nullable JSON columns reject the literal `null`; use
      // `Prisma.DbNull` to clear the column to SQL NULL on success.
      validationIssues: Prisma.DbNull,
    },
  });

  // biome-ignore lint/suspicious/noConsoleLog: intentional job lifecycle log
  console.log(
    `[ai-extraction] ok uploadId=${uploadId} model=${aiResult.meta.model} input=${aiResult.meta.inputTokens} output=${aiResult.meta.outputTokens} ms=${aiResult.meta.latencyMs}`,
  );
}

// Mark a draft FAILED with structured failure metadata. Used for
// non-retryable failures; retryable ones throw to let BullMQ retry.
async function markFailed(
  uploadId: string,
  failure: { stage: string; message: string; meta?: Record<string, unknown> },
): Promise<void> {
  const draft = await prisma.extractionDraft.findUnique({
    where: { uploadId },
    select: { id: true, progress: true },
  });
  if (!draft) return;
  const existing =
    draft.progress && typeof draft.progress === 'object' && !Array.isArray(draft.progress)
      ? (draft.progress as Record<string, unknown>)
      : {};
  await prisma.extractionDraft.update({
    where: { id: draft.id },
    data: {
      status: 'FAILED',
      progress: {
        ...existing,
        stage: 'FAILED',
        failure: {
          stage: failure.stage,
          message: failure.message,
          ...(failure.meta ?? {}),
          at: new Date().toISOString(),
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

// Lightweight progress update — the wizard's poll picks it up. Kept
// idempotent so retries don't trample a later state.
async function markProgress(
  uploadId: string,
  progress: { stage: string; sheetsCount?: number | undefined },
): Promise<void> {
  const draft = await prisma.extractionDraft.findUnique({
    where: { uploadId },
    select: { id: true, progress: true, status: true },
  });
  if (!draft) return;
  if (draft.status !== 'EXTRACTING') return; // already terminal
  const existing =
    draft.progress && typeof draft.progress === 'object' && !Array.isArray(draft.progress)
      ? (draft.progress as Record<string, unknown>)
      : {};
  await prisma.extractionDraft.update({
    where: { id: draft.id },
    data: {
      progress: {
        ...existing,
        stage: progress.stage,
        ...(progress.sheetsCount != null ? { sheetsCount: progress.sheetsCount } : {}),
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

// Re-run only the suggestion layer over the merged extracted products.
// We deliberately import the inner helpers from the extractor module
// rather than re-running the whole pipeline (which would re-do the
// heuristic parse, wasting time + memory on a 25 MB workbook).
async function rebuildSuggestionsForMerged(
  db: ReturnType<typeof createTenantClient>,
  mergedProducts: Awaited<ReturnType<typeof runAiExtraction>> extends infer R
    ? R extends { ok: true; products: infer P }
      ? P
      : never
    : never,
): Promise<Record<string, unknown>> {
  // Late-import to avoid circular module dep with the extractor.
  const [{ suggestBenefitGroups }, { reconcile }] = await Promise.all([
    import('@/server/extraction/predicate-suggester'),
    import('@/server/extraction/reconciliation'),
  ]);
  const employeeSchema = await db.employeeSchema.findFirst({ select: { fields: true } });
  const employeeFields =
    (employeeSchema?.fields as Array<{
      name: string;
      label: string;
      type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum';
      enumValues?: string[];
    }> | null) ?? [];

  const benefitGroups = suggestBenefitGroups(mergedProducts, employeeFields);
  const eligibilityMatrix = benefitGroups.map((g) => ({
    groupRawLabel: g.sourcePlanLabel,
    perProduct: mergedProducts.map((p) => {
      const match = p.plans.find((pl) =>
        pl.rawName.toLowerCase().includes(g.sourcePlanLabel.toLowerCase().slice(0, 8)),
      );
      return {
        productTypeCode: p.productTypeCode,
        defaultPlanRawCode: match?.rawCode ?? null,
      };
    }),
  }));

  // Walk benefit groups for missing employee-schema fields. Mirrors
  // the same loop in extractor.ts; kept inline because the helper
  // there is private.
  const knownFieldNames = new Set(employeeFields.map((f) => f.name));
  type MissingField = {
    fieldPath: string;
    suggestedType: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum';
    suggestedLabel: string;
    referencedBy: string[];
    enumValues?: string[];
  };
  const missingMap = new Map<string, MissingField>();
  const collectVarRefs = (node: unknown, out: string[] = []): string[] => {
    if (node == null) return out;
    if (Array.isArray(node)) {
      for (const child of node) collectVarRefs(child, out);
      return out;
    }
    if (typeof node !== 'object') return out;
    const obj = node as Record<string, unknown>;
    if ('var' in obj && typeof obj.var === 'string') {
      out.push(obj.var);
      return out;
    }
    for (const v of Object.values(obj)) collectVarRefs(v, out);
    return out;
  };
  const guessFieldTypeFromName = (path: string): MissingField['suggestedType'] => {
    const lower = path.toLowerCase();
    if (/grade|level|count|year|age/.test(lower)) return 'integer';
    if (/firefighter|bargainable|manual_worker|is_|has_/.test(lower)) return 'boolean';
    if (/date/.test(lower)) return 'date';
    if (/country|region|type|class|status/.test(lower)) return 'enum';
    return 'string';
  };
  const humanizeFieldName = (path: string): string =>
    path
      .replace(/^employee\./, '')
      .split('_')
      .map((w) => (w.length > 0 ? w[0]?.toUpperCase() + w.slice(1) : w))
      .join(' ');
  for (const g of benefitGroups) {
    for (const ref of collectVarRefs(g.predicate)) {
      if (knownFieldNames.has(ref)) continue;
      if (!missingMap.has(ref)) {
        missingMap.set(ref, {
          fieldPath: ref,
          suggestedType: guessFieldTypeFromName(ref),
          suggestedLabel: humanizeFieldName(ref),
          referencedBy: [],
        });
      }
      const existing = missingMap.get(ref);
      if (existing && !existing.referencedBy.includes(g.sourcePlanLabel)) {
        existing.referencedBy.push(g.sourcePlanLabel);
      }
    }
  }

  return {
    benefitGroups,
    eligibilityMatrix,
    missingPredicateFields: Array.from(missingMap.values()),
    reconciliation: reconcile(mergedProducts),
  };
}
