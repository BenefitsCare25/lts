// =============================================================
// Next.js App Router → tRPC fetch adapter handler.
//
// One handler reused for GET (queries) and POST (mutations).
// The fetch adapter is the recommended adapter for App Router
// and Edge runtime; we run on Node by default.
// =============================================================

import { createContext } from '@/server/trpc/context';
import { appRouter } from '@/server/trpc/router';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
