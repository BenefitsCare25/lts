import { headers } from "next/headers";

import { getDatabaseStatus } from "~/server/db/status";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Touch headers so this stays a request-scoped server render.
  await headers();
  const status = await getDatabaseStatus();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-slate-500">LTS</p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Insurance brokerage platform
        </h1>
        <p className="text-base text-slate-600">
          Phase 1 scaffold. Broker admin surfaces will land under <code>/admin</code>.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Environment
        </h2>
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="font-medium text-slate-700">Database</dt>
          <dd className="text-slate-600">
            {status.ok ? (
              <span className="text-emerald-700">connected — {status.detail}</span>
            ) : (
              <span className="text-amber-700">unreachable — {status.detail}</span>
            )}
          </dd>
          <dt className="font-medium text-slate-700">Node</dt>
          <dd className="font-mono text-slate-600">{process.version}</dd>
        </dl>
      </section>

      <p className="text-xs text-slate-500">Next: WorkOS sign-in (S3) and the admin layout (S5).</p>
    </main>
  );
}
