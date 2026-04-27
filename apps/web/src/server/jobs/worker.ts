import { Worker } from 'bullmq';
import { HELLO_WORLD_JOB, processHelloWorld } from './hello-world';
import { QUEUE_NAMES } from './queues';
import { getRedisConnection, isRedisConfigured } from './redis';

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
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );

  _worker.on('failed', (job, err) => {
    console.error(`[jobs] job ${job?.id} (${job?.name}) failed:`, err);
  });

  // biome-ignore lint/suspicious/noConsoleLog: intentional startup log
  console.log('[jobs] Worker started on queue:', QUEUE_NAMES.DEFAULT);
}
