// =============================================================
// tRPC bootstrap — single shared instance + procedure helpers.
//
// publicProcedure    — no auth required (e.g. health.ping).
// protectedProcedure — UNAUTHORIZED when session is null.
// tenantProcedure    — UNAUTHORIZED + resolves tenant; ctx gains
//                      tenantId, userId, db (tenant-scoped client).
//                      Auto-audits successful mutations to AuditLog.
//                      Use for read-only / list / byId queries.
// adminProcedure     — tenantProcedure + role gate. Allows the
//                      three broker roles (TENANT_ADMIN,
//                      BROKER_ADMIN, CATALOGUE_ADMIN). Use for
//                      every mutation in the broker admin surface.
// =============================================================

import { auditEvent, deriveEntity } from '@/server/audit';
import { UserNotProvisionedError, requireTenantContext } from '@/server/db/tenant';
import { UserRole } from '@prisma/client';
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

// Every tenant-scoped procedure should use tenantProcedure for
// queries; mutations should use adminProcedure (below) so the role
// gate fires before any state changes.
// ctx.db is a Prisma client pre-scoped to ctx.tenantId.
export const tenantProcedure = t.procedure
  .use(requireSessionMiddleware)
  .use(requireTenantMiddleware)
  .use(auditMutationsMiddleware);

// The three internal broker roles. CLIENT_HR / EMPLOYEE exist in
// the enum for the Phase 2 employee portal; they must NOT reach
// any broker-admin mutation.
const BROKER_ROLES = new Set<UserRole>([
  UserRole.TENANT_ADMIN,
  UserRole.BROKER_ADMIN,
  UserRole.CATALOGUE_ADMIN,
]);

// roleGuard rejects callers whose User.role isn't in `allowed`.
// Stricter inline gates inside specific handlers (e.g. publish
// requiring TENANT_ADMIN | BROKER_ADMIN) layer on top of this.
//
// Reads the role from ctx.session.user.role (the JWT-carried value)
// rather than re-querying the DB — requireTenantContext() upstream
// already confirmed the User row exists, and avoiding a DB round-trip
// keeps the middleware cheap on every mutation.
export function roleGuard(allowed: ReadonlySet<UserRole>) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required.' });
    }
    const role = ctx.session.user.role as UserRole | undefined;
    if (!role || !allowed.has(role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      });
    }
    return next();
  });
}

// Use for all broker-admin mutations. Composing on top of
// tenantProcedure means ctx.db / ctx.userId / ctx.tenantId are
// already populated and the audit middleware has fired.
export const adminProcedure = tenantProcedure.use(roleGuard(BROKER_ROLES));
