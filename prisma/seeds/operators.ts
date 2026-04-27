// S7: Operator Library seeding — 6 data type rows per v2 §3.2

import type { PrismaClient } from '@prisma/client';

interface Operator {
  code: string;
  label: string;
  arity: 'single' | 'multi' | 'range';
}

interface OperatorLibrarySeed {
  dataType: string;
  operators: Operator[];
}

const NUMBER_OPERATORS: Operator[] = [
  { code: 'eq', label: '=', arity: 'single' },
  { code: 'neq', label: '≠', arity: 'single' },
  { code: 'lt', label: '<', arity: 'single' },
  { code: 'lte', label: '≤', arity: 'single' },
  { code: 'gt', label: '>', arity: 'single' },
  { code: 'gte', label: '≥', arity: 'single' },
  { code: 'between', label: 'between', arity: 'range' },
  { code: 'in', label: 'is one of', arity: 'multi' },
  { code: 'notIn', label: 'is not one of', arity: 'multi' },
];

export const OPERATOR_LIBRARY: OperatorLibrarySeed[] = [
  {
    dataType: 'string',
    operators: [
      { code: 'eq', label: 'equals', arity: 'single' },
      { code: 'neq', label: 'does not equal', arity: 'single' },
      { code: 'contains', label: 'contains', arity: 'single' },
      { code: 'startsWith', label: 'starts with', arity: 'single' },
      { code: 'endsWith', label: 'ends with', arity: 'single' },
      { code: 'in', label: 'is one of', arity: 'multi' },
      { code: 'notIn', label: 'is not one of', arity: 'multi' },
    ],
  },
  {
    dataType: 'integer',
    operators: NUMBER_OPERATORS,
  },
  {
    dataType: 'number',
    operators: NUMBER_OPERATORS,
  },
  {
    dataType: 'boolean',
    operators: [{ code: 'eq', label: 'is', arity: 'single' }],
  },
  {
    dataType: 'date',
    operators: [
      { code: 'eq', label: 'on', arity: 'single' },
      { code: 'before', label: 'before', arity: 'single' },
      { code: 'after', label: 'after', arity: 'single' },
      { code: 'between', label: 'between', arity: 'range' },
      { code: 'withinDays', label: 'within last N days', arity: 'single' },
    ],
  },
  {
    dataType: 'enum',
    operators: [
      { code: 'eq', label: 'is', arity: 'single' },
      { code: 'neq', label: 'is not', arity: 'single' },
      { code: 'in', label: 'is one of', arity: 'multi' },
      { code: 'notIn', label: 'is not one of', arity: 'multi' },
    ],
  },
];

export async function seedOperatorLibrary(prisma: PrismaClient): Promise<void> {
  for (const entry of OPERATOR_LIBRARY) {
    await prisma.operatorLibrary.upsert({
      where: { dataType: entry.dataType },
      update: { operators: entry.operators },
      create: { dataType: entry.dataType, operators: entry.operators },
    });
  }
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(`[seed] operator library: ${OPERATOR_LIBRARY.length} data type rows seeded`);
}
