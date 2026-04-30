// =============================================================
// Audit logging — Phase 2A item 3.
//
// Two entry points:
//
//   - The tRPC `auditMutationsMiddleware` (wired into `tenantProcedure`
//     in trpc/init.ts) auto-logs every successful mutation. The
//     procedure path (e.g. "insurers.create") becomes the action.
//
//   - `auditEvent()` lets a mutation handler write a richer log
//     entry (with before/after snapshots) when the cheap auto-log
//     isn't enough. Both writes happen on the same connection that
//     just succeeded the mutation, so RLS sees a valid tenant scope.
//
// Design notes.
//
//   - We use `ctx.db.auditLog.create(...)` so the tenant-scoping
//     Prisma extension stamps tenantId automatically. AuditLog is
//     in TENANT_MODELS in db/tenant.ts.
//
//   - All logs are best-effort: a failing write goes to stderr but
//     does not throw — auditing must never break the actual mutation.
//
//   - JSON fields (before/after) are sanitised for known sensitive
//     keys and truncated past MAX_JSON_SIZE so we don't blow up the
//     audit table with multi-megabyte file uploads or password hashes.
// =============================================================

import { Prisma } from '@prisma/client';
import type { TenantDb } from './db/tenant';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'secret',
  'apiKey',
  // BYOK ciphertext from secret-cipher.ts. Not directly sensitive
  // (decrypt requires APP_SECRET_KEY), but redacted for defence in
  // depth — log analytics shouldn't hold encrypted credentials.
  'encryptedKey',
  'contentBase64', // file uploads
]);

const MAX_JSON_SIZE = 4 * 1024;

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : sanitize(v);
  }
  return out;
}

function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  const sanitised = sanitize(value);
  const serialised = JSON.stringify(sanitised);
  if (serialised.length <= MAX_JSON_SIZE) {
    return JSON.parse(serialised) as Prisma.InputJsonValue;
  }
  return {
    _truncated: true,
    _originalSize: serialised.length,
    preview: serialised.slice(0, MAX_JSON_SIZE),
  } as Prisma.InputJsonValue;
}

export type AuditEvent = {
  db: TenantDb;
  userId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
};

// Write an audit log row. Best-effort: errors are logged to stderr
// instead of being thrown.
export async function auditEvent(event: AuditEvent): Promise<void> {
  try {
    await event.db.auditLog.create({
      data: {
        // tenantId is auto-stamped by the Prisma extension in db/tenant.ts.
        // We pass an empty string here only to satisfy the static type;
        // the extension overwrites it before the SQL is sent.
        tenantId: '',
        userId: event.userId,
        action: event.action,
        entityType: event.entityType ?? '',
        entityId: event.entityId ?? '',
        before: toAuditJson(event.before),
        after: toAuditJson(event.after),
      },
    });
  } catch (err) {
    console.error('[audit] failed to write log', { action: event.action, err });
  }
}

// Best-effort entity extraction from the tRPC procedure path + input
// for the auto-logging middleware. `insurers.create` → entityType="insurers".
// `input.id` is used as entityId when present.
export function deriveEntity(
  path: string,
  input: unknown,
): { entityType: string; entityId: string } {
  const dot = path.indexOf('.');
  const entityType = dot >= 0 ? path.slice(0, dot) : path;
  const entityId =
    input && typeof input === 'object' && 'id' in input
      ? String((input as { id: unknown }).id)
      : '';
  return { entityType, entityId };
}
