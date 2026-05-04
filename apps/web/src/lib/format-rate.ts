export type RateShape = { ratePerThousand: number | null; fixedAmount: number | null } | null;

export function formatRate(rate: RateShape): string {
  if (!rate) return '—';
  if (rate.fixedAmount != null) return `$${rate.fixedAmount.toFixed(2)} / yr`;
  if (rate.ratePerThousand != null) return `$${rate.ratePerThousand.toFixed(4)} per $1,000 SI`;
  return '—';
}
