// =============================================================
// Request-scoped tRPC context.
//
// S2 attaches the WorkOS session (or null for unauthenticated
// requests). S3 will layer tenant id and a tenant-scoped Prisma
// client on top of this. Procedures that need the user must use
// `protectedProcedure` from ./init.ts to surface UNAUTHORIZED
// when session is null.
// =============================================================

import { type Session, getSession } from '@/server/auth/session';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';

export type Context = {
  session: Session | null;
};

export async function createContext(_opts: FetchCreateContextFnOptions): Promise<Context> {
  // withAuth() reads the encrypted cookie set by AuthKit's middleware.
  // Outside a Next.js request scope it returns { user: null } — fine
  // for tests calling appRouter.createCaller directly with their own ctx.
  const session = await getSession();
  return { session };
}
