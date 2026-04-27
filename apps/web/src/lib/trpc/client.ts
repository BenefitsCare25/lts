// =============================================================
// Browser-side tRPC client + React-Query bindings.
//
// `trpc` is the typed React hooks client (useQuery, useMutation,
// useUtils, etc.). The same `AppRouter` type is the single source
// of truth for the request/response shapes — never duplicate it
// on the client.
// =============================================================

import type { AppRouter } from '@/server/trpc/router';
import { createTRPCReact } from '@trpc/react-query';

export const trpc = createTRPCReact<AppRouter>();
