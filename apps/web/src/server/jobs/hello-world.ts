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

export async function processHelloWorld(_job: Job<HelloWorldData>): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}
