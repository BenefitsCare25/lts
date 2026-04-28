// =============================================================
// tRPC bootstrap — single shared instance + procedure helpers.
//
// publicProcedure    — no auth required (e.g. health.ping).
// protectedProcedure — UNAUTHORIZED when session is null.
// tenantProcedure    — UNAUTHORIZED + resolves tenant; ctx gains
//                      tenantId, userId, db (tenant-scoped client).
//                      Auto-audits successful mutations to AuditLog.
// =============================================================

import { auditEvent, deriveEntity } from '@/server/audit';
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

// Logs every successful mutation through tenantProcedure. Queries
// pass through as no-ops. Failures aren't logged here — they go to
// the request-level error handler — so the audit trail captures
// only persisted state changes. Per-mutation `auditEvent()` calls
// inside handlers can layer richer before/after snapshots on top.
const auditMutationsMiddleware = t.middleware(async ({ ctx, next, type, path, input }) => {
  const result = await next();
  if (type !== 'mutation' || !result.ok) return result;

  // ctx is the post-tenant ctx — db, userId, tenantId all populated.
  const tenantCtx = ctx as typeof ctx & {
    db: import('@/server/db/tenant').TenantDb;
    userId: string;
  };
  if (!tenantCtx.db || !tenantCtx.userId) return result;

  const { entityType, entityId } = deriveEntity(path, input);
  await auditEvent({
    db: tenantCtx.db,
    userId: tenantCtx.userId,
    action: path,
    entityType,
    entityId,
    after: input,
  });

  return result;
});

// Every broker-admin procedure should use tenantProcedure.
// ctx.db is a Prisma client pre-scoped to ctx.tenantId.
export const tenantProcedure = t.procedure
  .use(requireSessionMiddleware)
  .use(requireTenantMiddleware)
  .use(auditMutationsMiddleware);
