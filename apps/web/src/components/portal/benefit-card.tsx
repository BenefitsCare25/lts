import { formatDate } from '@/lib/format-date';
import { type RateShape, formatRate } from '@/lib/format-rate';

type BenefitRow = {
  enrollmentId: string;
  productTypeName: string | null;
  productTypeCode: string | null;
  planCode: string | null;
  planName: string | null;
  coverBasis: string | null;
  benefitGroupName: string | null;
  coverTier: string | null;
  effectiveFrom: Date | string;
  rate: RateShape;
};

export function BenefitCard({ row }: { row: BenefitRow }) {
  return (
    <div className="card card-padded">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold">
            {row.productTypeName ?? row.productTypeCode ?? 'Benefit'}
          </h3>
          {row.planName && (
            <p className="text-sm text-muted-foreground">
              {row.planCode ? `${row.planCode} — ` : ''}
              {row.planName}
            </p>
          )}
        </div>
        {row.coverTier && <span className="badge">{row.coverTier}</span>}
      </div>
      <dl className="field-dl">
        {row.benefitGroupName && (
          <div className="field-dl__row">
            <dt className="field-dl__label">Group</dt>
            <dd className="field-dl__value">{row.benefitGroupName}</dd>
          </div>
        )}
        <div className="field-dl__row">
          <dt className="field-dl__label">Premium</dt>
          <dd className="field-dl__value">{formatRate(row.rate)}</dd>
        </div>
        <div className="field-dl__row">
          <dt className="field-dl__label">Effective from</dt>
          <dd className="field-dl__value">{formatDate(row.effectiveFrom)}</dd>
        </div>
      </dl>
    </div>
  );
}
