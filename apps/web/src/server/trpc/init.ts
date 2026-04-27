// =============================================================
// tRPC bootstrap — single shared instance + procedure helpers.
//
// publicProcedure    — no auth required (e.g. health.ping).
// protectedProcedure — UNAUTHORIZED when session is null.
// tenantProcedure    — UNAUTHORIZED + resolves tenant; ctx gains
//                      tenantId, userId, db (tenant-scoped client).
// =============================================================

import { UserNotProvisionedError, requireTenantContext } from '@/server/db/tenant';
import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;

export const publicProcedure = t.procedure;

const requireSessionMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required.' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const protectedProcedure = t.procedure.use(requireSessionMiddleware);

const requireTenantMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required.' });
  }
  try {
    const tenantCtx = await requireTenantContext(ctx.session.user.id);
    return next({ ctx: { ...ctx, ...tenantCtx } });
  } catch (err) {
    if (err instanceof UserNotProvisionedError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
});

// Every broker-admin procedure should use tenantProcedure.
// ctx.db is a Prisma client pre-scoped to ctx.tenantId.
export const tenantProcedure = t.procedure
  .use(requireSessionMiddleware)
  .use(requireTenantMiddleware);
