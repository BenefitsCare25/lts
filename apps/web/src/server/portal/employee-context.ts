import { prisma } from '@/server/db/client';
import { TRPCError } from '@trpc/server';

export type EmployeeContext = {
  employeeId: string;
  clientId: string;
};

/**
 * Resolves the Employee record linked to a User via Employee.userId.
 * Returns employeeId + clientId for downstream query scoping.
 * Throws FORBIDDEN if the user has no linked employee.
 */
export async function resolveEmployeeFromUser(userId: string): Promise<EmployeeContext> {
  const employee = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true, clientId: true },
  });

  if (!employee) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No employee record linked to this account.',
    });
  }

  return { employeeId: employee.id, clientId: employee.clientId };
}
