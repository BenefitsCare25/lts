// Queue introspection — admin-only diagnostic for job-state bugs.
// Returns BullMQ queue counts (waiting / active / completed / failed /
// delayed) plus a small sample of waiting + failed jobs so we can see
// whether jobs are actually landing in Redis when the wizard says
// "QUEUED" but the worker never picks them up.

import { requireSession } from '@/server/auth/session';
import { getDefaultQueue } from '@/server/jobs/queues';
import { isRedisConfigured } from '@/server/jobs/redis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Gated to authenticated sessions — not a public endpoint.
  await requireSession();

  if (!isRedisConfigured()) {
    return NextResponse.json({ status: 'unconfigured' }, { status: 503 });
  }

  try {
    const queue = getDefaultQueue();
    const counts = await queue.getJobCounts(
      'wait',
      'active',
      'delayed',
      'completed',
      'failed',
      'paused',
    );
    const [waiting, active, failed] = await Promise.all([
      queue.getJobs(['wait'], 0, 9, true),
      queue.getJobs(['active'], 0, 9, true),
      queue.getJobs(['failed'], 0, 9, true),
    ]);
    return NextResponse.json({
      status: 'ok',
      counts,
      sample: {
        waiting: waiting.map((j) => ({
          id: j.id,
          name: j.name,
          attemptsMade: j.attemptsMade,
          timestamp: j.timestamp,
          data: j.data,
        })),
        active: active.map((j) => ({
          id: j.id,
          name: j.name,
          attemptsMade: j.attemptsMade,
          timestamp: j.timestamp,
        })),
        failed: failed.map((j) => ({
          id: j.id,
          name: j.name,
          attemptsMade: j.attemptsMade,
          timestamp: j.timestamp,
          failedReason: j.failedReason,
          stacktrace: j.stacktrace?.slice(0, 3),
        })),
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', message: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
