// ioredis connection singleton shared across all queues and workers.
// BullMQ requires maxRetriesPerRequest=null for blocking commands.

import IORedis from 'ioredis';

let _connection: IORedis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function getRedisConnection(): IORedis {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not set. Redis is not configured for this environment.');
  }
  if (!_connection) {
    _connection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
    });
  }
  return _connection;
}
