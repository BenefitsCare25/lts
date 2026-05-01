'use client';

import { trpc } from '@/lib/trpc/client';

export default function HomePage() {
  const ping = trpc.health.ping.useQuery();

  return (
    <main>
      <h1>Insurance SaaS Platform</h1>
      <p>
        Phase 1 build. tRPC and WorkOS auth wiring are in place; multi-tenancy + Postgres RLS (Story
        S3) follow next.
      </p>
      <p>
        <a href="/admin">Open admin →</a>
      </p>
      <section>
        <h2>tRPC health</h2>
        {ping.isLoading ? (
          <p>pinging…</p>
        ) : ping.error ? (
          <p>error: {ping.error.message}</p>
        ) : (
          <p>
            {ping.data?.status} @ {ping.data?.timestamp}
          </p>
        )}
      </section>
    </main>
  );
}
