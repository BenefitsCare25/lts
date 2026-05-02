// Rate-row mapping — converts parsed rate rows into PremiumRateField envelopes.
//
// Ghost rate guard: any ratePerThousand > 10_000 is silently dropped.
// WICI and similar placement slips store annual earnings (~200M) as a raw
// cell value in the rates column; astronomical values are not real rates.

import { excelColumnIndex } from '@/server/catalogue/premium-strategy';
import type { ParsedProduct, ParsingRules } from '@/server/ingestion/parser';
import type { PremiumRateField } from './types';

export function buildRates(
  parsed: ParsedProduct,
  map: NonNullable<ParsingRules['rate_column_map']>,
): PremiumRateField[] {
  const rates: PremiumRateField[] = [];
  const planMatchKey = `col${excelColumnIndex(map.planMatch)}`;

  for (const row of parsed.rates) {
    const rawLabel = row[planMatchKey];
    if (!rawLabel) continue;
    const labelStr = String(rawLabel).trim();
    if (!labelStr) continue;
    const blockLabel = (row._blockLabel as string) ?? null;

    if (map.tiers && map.tiers.length > 0) {
      for (const t of map.tiers) {
        const cell = row[`col${excelColumnIndex(t.rateColumn)}`];
        const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
        if (!Number.isFinite(num) || num <= 0) continue;
        rates.push({
          planRawCode: labelStr,
          coverTier: t.tier,
          ratePerThousand: null,
          fixedAmount: num,
          blockLabel,
          ageBand: null,
          confidence: 0.95,
          sourceRef: { sheet: parsed.ratesSheet ?? parsed.templateInsurerCode, cell: t.rateColumn },
        });
      }
    } else if (map.ratePerThousand) {
      const cell = row[`col${excelColumnIndex(map.ratePerThousand)}`];
      const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
      // Ghost rate guard: drop astronomical values (> 10_000) — these are
      // annual earnings stored in the rate column, not real premium rates.
      if (Number.isFinite(num) && num > 0 && num <= 10_000) {
        rates.push({
          planRawCode: labelStr,
          coverTier: null,
          ratePerThousand: num,
          fixedAmount: null,
          blockLabel,
          ageBand: null,
          confidence: 0.95,
          sourceRef: {
            sheet: parsed.ratesSheet ?? parsed.templateInsurerCode,
            cell: map.ratePerThousand,
          },
        });
      }
    } else if (map.fixedAmount) {
      const cell = row[`col${excelColumnIndex(map.fixedAmount)}`];
      const num = typeof cell === 'number' ? cell : Number.parseFloat(String(cell ?? ''));
      if (Number.isFinite(num) && num > 0) {
        rates.push({
          planRawCode: labelStr,
          coverTier: null,
          ratePerThousand: null,
          fixedAmount: num,
          blockLabel,
          ageBand: null,
          confidence: 0.95,
          sourceRef: {
            sheet: parsed.ratesSheet ?? parsed.templateInsurerCode,
            cell: map.fixedAmount,
          },
        });
      }
    }
  }

  return rates;
}
