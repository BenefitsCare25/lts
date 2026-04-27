// =============================================================
// Tenant context — the single entry point for all tenant-scoped
// database access in Phase 1.
//
// requireTenantContext(userId)
//   Resolves the tenant from the internal User.id (Auth.js session
//   carries this). Sets the Postgres RLS session variable and
//   returns a tenant-scoped Prisma client.
//
// createTenantClient(tenantId)
//   Wraps the base Prisma client with a $extends query extension
//   that auto-injects and auto-filters tenantId on every CRUD
//   operation for the 8 directly tenant-scoped models.
//
// __requireServiceContext()
//   Returns the raw Prisma client for cross-tenant reads.
//   Must only be used from platform-admin code paths, never broker.
// =============================================================

import { prisma } from './client';

// The 8 models that carry a direct tenantId column.
// Models accessed only via relations (Policy → Client, Employee → Client,
// etc.) are isolated at the app layer by navigating through their
// tenant-scoped parent, and at the DB layer by RLS on that parent.
const TENANT_MODELS = new Set([
  'User',
  'EmployeeSchema',
  'Insurer',
  'TPA',
  'Pool',
  'ProductType',
  'Client',
  'AuditLog',
]);

export class UserNotProvisionedError extends Error {
  constructor() {
    super('User not provisioned. Contact your administrator.');
    this.name = 'UserNotProvisionedError';
  }
}

// Returns a Prisma client pre-scoped to tenantId.
// - create / createMany / upsert: stamps tenantId onto data
// - findMany / findFirst / count / aggregate: injects where.tenantId
// - update / updateMany / delete / deleteMany: injects where.tenantId
// - findUnique: not intercepted — RLS at the DB layer handles isolation
export function createTenantClient(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        // biome-ignore lint/suspicious/noExplicitAny: args shape varies per operation
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) return query(args);

          if (operation === 'create') {
            args.data = { ...args.data, tenantId };
          } else if (operation === 'createMany') {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            args.data = rows.map((r: object) => ({ ...r, tenantId }));
          } else if (operation === 'upsert') {
            args.create = { ...args.create, tenantId };
            args.where = { ...args.where, tenantId };
          } else if (
            ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate'].includes(operation)
          ) {
            args.where = { ...args.where, tenantId };
          } else if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
            args.where = { ...args.where, tenantId };
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof createTenantClient>;

export type TenantContext = {
  tenantId: string;
  userId: string;
  db: TenantDb;
};

// Resolves a fully-scoped TenantContext for a signed-in user.
// Sets the Postgres RLS variable app.current_tenant_id so DB-layer
// policies enforce isolation as a second line of defence.
export async function requireTenantContext(userId: string): Promise<TenantContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true },
  });

  if (!user) {
    throw new UserNotProvisionedError();
  }

  // set_config(key, value, is_local=false) persists for the connection,
  // which is sufficient for a request-scoped Prisma connection.
  // is_local=true would scope it to the current transaction only.
  await prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${user.tenantId}, false)`;

  return {
    tenantId: user.tenantId,
    userId: user.id,
    db: createTenantClient(user.tenantId),
  };
}

// Cross-tenant service context. Only valid for platform-admin operations
// (e.g. aggregated billing dashboards). All call sites must be deliberate.
export function __requireServiceContext() {
  return prisma;
}
