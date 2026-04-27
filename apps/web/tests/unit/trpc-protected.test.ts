import type { Session } from '@/server/auth/session';
import { protectedProcedure, router } from '@/server/trpc/init';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

const testRouter = router({
  whoami: protectedProcedure.query(({ ctx }) => ({
    email: ctx.session.user.email,
  })),
});

const sampleSession: Session = {
  user: {
    id: 'user_test_123',
    email: 'sam@example.com',
    tenantId: 'tenant_test_123',
    role: 'BROKER_ADMIN',
    firstName: 'Sam',
    lastName: 'Tester',
    roles: ['BROKER_ADMIN'],
  },
};

describe('tRPC protectedProcedure', () => {
  it('throws UNAUTHORIZED when ctx.session is null', async () => {
    const caller = testRouter.createCaller({ session: null });

    await expect(caller.whoami()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.whoami()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('resolves and exposes ctx.session.user when authenticated', async () => {
    const caller = testRouter.createCaller({ session: sampleSession });
    const result = await caller.whoami();
    expect(result).toEqual({ email: 'sam@example.com' });
  });
});
