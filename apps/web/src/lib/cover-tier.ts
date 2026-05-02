// Cover tier derivation — determines premium rate tier from dependents.
//
// Cover tiers: EO (employee only), ES (employee + spouse),
//              EC (employee + child(ren)), EF (employee + family)
//
// Some products only support EO and EF. `supportedCoverTiers` lets
// callers collapse ES/EC → EF for those products.

export type CoverTier = 'EO' | 'ES' | 'EC' | 'EF';

export type Dependent = {
  relationship: 'SPOUSE' | 'CHILD' | (string & {});
  terminationDate?: Date | string | null;
};

export function deriveCoverTier(dependents: Dependent[]): CoverTier {
  const active = dependents.filter((d) => !d.terminationDate);
  const hasSpouse = active.some((d) => d.relationship === 'SPOUSE');
  const hasChild = active.some((d) => d.relationship === 'CHILD');
  if (!hasSpouse && !hasChild) return 'EO';
  if (hasSpouse && !hasChild) return 'ES';
  if (!hasSpouse && hasChild) return 'EC';
  return 'EF';
}

// Collapse a derived tier to the nearest supported tier.
// Products with only EO/EF (no ES/EC rows) should call this to avoid
// looking up a rate that doesn't exist.
export function collapseTier(tier: CoverTier, supported: CoverTier[]): CoverTier {
  if (supported.includes(tier)) return tier;
  if ((tier === 'ES' || tier === 'EC') && supported.includes('EF')) return 'EF';
  return 'EO';
}
