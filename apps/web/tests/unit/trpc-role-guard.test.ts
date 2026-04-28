import type { Session } from '@/server/auth/session';
import { protectedProcedure, roleGuard, router } from '@/server/trpc/init';
import { UserRole } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

const adminOnly = protectedProcedure.use(
  roleGuard(new Set<UserRole>([UserRole.TENANT_ADMIN, UserRole.BROKER_ADMIN])),
);

const testRouter = router({
  publish: adminOnly.mutation(() => ({ ok: true })),
});

function sessionWithRole(role: UserRole): Session {
  return {
    user: {
      id: 'user_test',
      email: 'tester@example.com',
      tenantId: 'tenant_test',
      role,
      firstName: null,
      lastName: null,
      roles: [role],
    },
  };
}

describe('roleGuard', () => {
  it('allows TENANT_ADMIN through', async () => {
    const caller = testRouter.createCaller({ session: sessionWithRole(UserRole.TENANT_ADMIN) });
    await expect(caller.publish()).resolves.toEqual({ ok: true });
  });

  it('allows BROKER_ADMIN through', async () => {
    const caller = testRouter.createCaller({ session: sessionWithRole(UserRole.BROKER_ADMIN) });
    await expect(caller.publish()).resolves.toEqual({ ok: true });
  });

  it('forbids CATALOGUE_ADMIN when not in the allowed set', async () => {
    const caller = testRouter.createCaller({ session: sessionWithRole(UserRole.CATALOGUE_ADMIN) });
    await expect(caller.publish()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.publish()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('forbids CLIENT_HR (non-broker role)', async () => {
    const caller = testRouter.createCaller({ session: sessionWithRole(UserRole.CLIENT_HR) });
    await expect(caller.publish()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('forbids EMPLOYEE (non-broker role)', async () => {
    const caller = testRouter.createCaller({ session: sessionWithRole(UserRole.EMPLOYEE) });
    await expect(caller.publish()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects unauthenticated callers with UNAUTHORIZED before reaching the role check', async () => {
    const caller = testRouter.createCaller({ session: null });
    await expect(caller.publish()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
