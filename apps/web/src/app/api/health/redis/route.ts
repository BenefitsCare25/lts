import { getRedisConnection, isRedisConfigured } from '@/server/jobs/redis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isRedisConfigured()) {
    return NextResponse.json({ status: 'unconfigured' }, { status: 503 });
  }
  try {
    await getRedisConnection().ping();
    return NextResponse.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ status: 'error', message: String(err) }, { status: 503 });
  }
}
