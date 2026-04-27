import type { Job } from 'bullmq';
import { getDefaultQueue } from './queues';

export const HELLO_WORLD_JOB = 'hello-world' as const;

export type HelloWorldData = {
  message: string;
};

export async function enqueueHelloWorld(data: HelloWorldData): Promise<string> {
  const job = await getDefaultQueue().add(HELLO_WORLD_JOB, data);
  return job.id ?? '';
}

export async function processHelloWorld(job: Job<HelloWorldData>): Promise<void> {
  // biome-ignore lint/suspicious/noConsoleLog: intentional job lifecycle log
  console.log(`[hello-world] job ${job.id} started — ${job.data.message}`);
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  // biome-ignore lint/suspicious/noConsoleLog: intentional job lifecycle log
  console.log(`[hello-world] job ${job.id} complete`);
}
