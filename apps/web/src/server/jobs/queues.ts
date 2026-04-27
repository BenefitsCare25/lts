import { Queue } from 'bullmq';
import { getRedisConnection } from './redis';

export const QUEUE_NAMES = {
  DEFAULT: 'default',
} as const;

let _defaultQueue: Queue | null = null;

export function getDefaultQueue(): Queue {
  if (!_defaultQueue) {
    _defaultQueue = new Queue(QUEUE_NAMES.DEFAULT, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return _defaultQueue;
}
