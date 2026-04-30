import { Worker } from 'bullmq';
import { prisma } from '@/server/db/client';
import {
  AI_EXTRACTION_JOB,
  type AiExtractionJobData,
  processAiExtraction,
} from './extraction';
import { HELLO_WORLD_JOB, processHelloWorld } from './hello-world';
import { QUEUE_NAMES } from './queues';
import { getRedisConnection, isRedisConfigured } from './redis';
import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';

let _worker: Worker | null = null;

export function startWorker(): void {
  if (!isRedisConfigured()) {
    console.warn('[jobs] REDIS_URL not set — worker not started.');
    return;
  }
  if (_worker) return;

  _worker = new Worker(
    QUEUE_NAMES.DEFAULT,
    async (job) => {
      if (job.name === HELLO_WORLD_JOB) {
        await processHelloWorld(job);
        return;
      }
      if (job.name === AI_EXTRACTION_JOB) {
        await processAiExtraction(job as Job<AiExtractionJobData>);
        return;
      }
    },
    {
      connection: getRedisConnection(),
      // Extraction jobs are heavy (60–90s, sometimes minutes). Cap
      // concurrency so a burst of imports doesn't saturate the DB
      // connection pool or the SharePoint download throughput. The
      // hello-world job rides on the same queue and is unaffected.
      concurrency: 3,
    },
  );

  _worker.on('failed', (job, err) => {
    console.error(`[jobs] job ${job?.id} (${job?.name}) failed:`, err);
    // For the extraction job specifically: when BullMQ exhausts all
    // retry attempts, mark the draft FAILED so the wizard surfaces it.
    // Throwing inside the processor signals "retry me"; reaching this
    // handler with attemptsMade >= attempts means we're out of retries.
    if (job?.name !== AI_EXTRACTION_JOB) return;
    const data = job.data as AiExtractionJobData | undefined;
    const attempts = job.opts?.attempts ?? 1;
    if (!data?.uploadId) return;
    if ((job.attemptsMade ?? 0) < attempts) return; // more retries pending
    finalizeFailure(data.uploadId, err.message).catch((finalizeErr) => {
      console.error(
        `[jobs] failed to mark draft FAILED for upload ${data.uploadId}:`,
        finalizeErr,
      );
    });
  });

  // biome-ignore lint/suspicious/noConsoleLog: intentional startup log
  console.log('[jobs] Worker started on queue:', QUEUE_NAMES.DEFAULT);
}

// Last-resort: when retries are exhausted, persist the failure to the
// draft. Keeps the wizard's status pill in sync with the queue's view.
async function finalizeFailure(uploadId: string, message: string): Promise<void> {
  const draft = await prisma.extractionDraft.findUnique({
    where: { uploadId },
    select: { id: true, status: true, progress: true },
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
      status: 'FAILED',
      progress: {
        ...existing,
        stage: 'FAILED',
        failure: {
          stage: 'JOB_RETRIES_EXHAUSTED',
          message,
          at: new Date().toISOString(),
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });
}
