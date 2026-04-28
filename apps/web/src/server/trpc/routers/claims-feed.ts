// =============================================================
// Claims feed router (S35 — TPA claims ingestion).
//
// Accepts a CSV (TPA-specific shape) plus an insurer reference,
// parses by Insurer.claimFeedProtocol (e.g. "IHP" → IHP CSV v1),
// looks up Enrollment per claim row to match employee + plan,
// and returns matched + unmatched lists.
//
// Phase 1 ships an "IHP" handler that reads:
//   memberId, claimDate, productCode, amount
// Real production formats vary per insurer/TPA; new formats are a
// code change to addClaimsFeedHandler() under server/ingestion/claims.
// =============================================================

import { prisma } from '@/server/db/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

type ClaimRow = {
  memberId: string;
  claimDate: string;
  productCode: string;
  amount: number;
  raw: Record<string, string>;
};

type MatchedClaim = ClaimRow & {
  matched: true;
  employeeId: string;
  enrollmentId: string;
};

type UnmatchedClaim = ClaimRow & { matched: false; reason: string };

// Naive CSV split. Production needs RFC 4180 + quoted fields; for
// Phase 1H structural ship, comma-split with no quoting is fine.
function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  if (first === undefined) return { headers: [], rows: [] };
  const headers = first.split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

// IHP handler — Tokio Marine's TPA. Maps CSV columns to ClaimRow.
function parseIhpRows(rows: Record<string, string>[]): ClaimRow[] {
  return rows
    .map((row) => {
      const memberId = row.memberId ?? row.MemberID ?? row['Member ID'] ?? '';
      const claimDate = row.claimDate ?? row.ClaimDate ?? row['Claim Date'] ?? '';
      const productCode = row.productCode ?? row.ProductCode ?? row.Product ?? '';
      const amountRaw = row.amount ?? row.Amount ?? row['Claim Amount'] ?? '0';
      const amount = Number.parseFloat(amountRaw);
      return {
        memberId,
        claimDate,
        productCode,
        amount: Number.isFinite(amount) ? amount : 0,
        raw: row,
      };
    })
    .filter((c) => c.memberId.length > 0);
}

const HANDLERS: Record<string, (rows: Record<string, string>[]) => ClaimRow[]> = {
  IHP: parseIhpRows,
  // TMLS, DIRECT_API land when their formats are spec'd.
};

async function assertInsurer(tenantId: string, insurerId: string) {
  const insurer = await prisma.insurer.findFirst({
    where: { id: insurerId, tenantId },
    select: { id: true, name: true, claimFeedProtocol: true },
  });
  if (!insurer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found.' });
  }
  return insurer;
}

async function assertClient(tenantId: string, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  });
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
  }
}

export const claimsFeedRouter = router({
  // Returns the supported claim-feed protocols (those with a handler).
  // The insurer admin UI can show this so users know which formats
  // currently parse.
  protocolsSupported: tenantProcedure.query(() => Object.keys(HANDLERS)),

  ingest: adminProcedure
    .input(
      z.object({
        insurerId: z.string().min(1),
        clientId: z.string().min(1),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Tenant-gate both ends — without this, the unmatched.reason
      // strings could enumerate other tenants' employees by id.
      await assertClient(ctx.tenantId, input.clientId);
      const insurer = await assertInsurer(ctx.tenantId, input.insurerId);
      if (!insurer.claimFeedProtocol) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${insurer.name} has no claimFeedProtocol set. Configure it in the insurer registry first.`,
        });
      }
      const handler = HANDLERS[insurer.claimFeedProtocol];
      if (!handler) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No parser registered for protocol "${insurer.claimFeedProtocol}". Supported: ${Object.keys(HANDLERS).join(', ')}.`,
        });
      }

      const buffer = Buffer.from(input.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty file.' });
      }
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File exceeds 10 MB limit.' });
      }
      const { rows: csvRows } = parseCsv(buffer.toString('utf8'));
      const claimRows = handler(csvRows);

      // Resolve every memberId to an Employee + active Enrollment on
      // the client. We assume memberId == Employee.id for Phase 1; in
      // production, the claim feed carries a separate memberId field
      // mapped via EmployeeSchema.
      const memberIds = Array.from(new Set(claimRows.map((c) => c.memberId)));
      const employees =
        memberIds.length > 0
          ? await prisma.employee.findMany({
              where: { id: { in: memberIds }, clientId: input.clientId },
              select: { id: true, enrollments: { select: { id: true, productId: true } } },
            })
          : [];
      const employeeMap = new Map(employees.map((e) => [e.id, e]));

      // Resolve productCode to productId on the client's policies.
      const productCodes = Array.from(new Set(claimRows.map((c) => c.productCode)));
      const products =
        productCodes.length > 0
          ? await prisma.product.findMany({
              where: {
                productType: { code: { in: productCodes }, tenantId: ctx.tenantId },
                benefitYear: { policy: { clientId: input.clientId } },
              },
              select: { id: true, productType: { select: { code: true } } },
            })
          : [];
      const productByCode = new Map(products.map((p) => [p.productType.code, p.id]));

      const matched: MatchedClaim[] = [];
      const unmatched: UnmatchedClaim[] = [];
      for (const claim of claimRows) {
        const employee = employeeMap.get(claim.memberId);
        if (!employee) {
          unmatched.push({ ...claim, matched: false, reason: 'No employee with that memberId.' });
          continue;
        }
        const productId = productByCode.get(claim.productCode);
        if (!productId) {
          unmatched.push({
            ...claim,
            matched: false,
            reason: `No product of type ${claim.productCode} on this client.`,
          });
          continue;
        }
        const enrollment = employee.enrollments.find((e) => e.productId === productId);
        if (!enrollment) {
          unmatched.push({
            ...claim,
            matched: false,
            reason: `Employee not enrolled in ${claim.productCode}.`,
          });
          continue;
        }
        matched.push({
          ...claim,
          matched: true,
          employeeId: employee.id,
          enrollmentId: enrollment.id,
        });
      }

      return {
        protocol: insurer.claimFeedProtocol,
        totalRows: claimRows.length,
        matched: matched.length,
        unmatched: unmatched.length,
        matchedClaims: matched.slice(0, 100),
        unmatchedClaims: unmatched.slice(0, 100),
      };
    }),
});
