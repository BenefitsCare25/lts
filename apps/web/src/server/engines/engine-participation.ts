import type { DependentCounts } from './types';

export type ParticipationInput = {
  counts: DependentCounts;
  dependantEligible: boolean;
};

export function resolveParticipationType(input: ParticipationInput): string {
  if (!input.dependantEligible) return 'EO';

  if (input.counts.activeSpouse > 0 && input.counts.activeChildren > 0) return 'EF';
  if (input.counts.activeSpouse > 0) return 'ES';
  if (input.counts.activeChildren > 0) return 'EC';
  return 'EO';
}
