import { appRouter } from '@/server/trpc/router';
import { describe, expect, it } from 'vitest';

describe('tRPC health router', () => {
  it('ping returns ok with an ISO timestamp', async () => {
    const caller = appRouter.createCaller({ session: null });
    const result = await caller.health.ping();

    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(Number.isNaN(new Date(result.timestamp).getTime())).toBe(false);
  });
});
