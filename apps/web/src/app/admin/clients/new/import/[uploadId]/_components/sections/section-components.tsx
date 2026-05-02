// =============================================================
// Section dispatch table — wizard-shell consumes this to render
// the active section by id, without a ternary chain. Each section
// gets the same `SectionRenderProps` bag and destructures what it
// needs; unused props are ignored.
// =============================================================

import type { AppRouter } from '@/server/trpc/router';
import type { inferRouterOutputs } from '@trpc/server';
import type { ComponentType } from 'react';
import type { DraftFormState, SectionId } from './_registry';
import { ClientSection } from './client';
import { InsurersPoolSection } from './insurers-pool';
import { PolicyEntitiesSection } from './policy-entities';
import { ProductsSection } from './products';
import { ReconciliationSection } from './reconciliation';
import { ReviewSection } from './review';
import { SchemaAdditionsSection } from './schema-additions';
import { SourceSummarySection } from './source-summary';

type Draft = inferRouterOutputs<AppRouter>['extractionDrafts']['byUploadId'];
type SectionStatusMap = Record<SectionId, 'complete' | 'in_progress' | 'has_issues' | 'pending'>;

export type SectionRenderProps = {
  draft: Draft;
  form: DraftFormState;
  setForm: React.Dispatch<React.SetStateAction<DraftFormState>>;
  sectionStatus: SectionStatusMap;
  applyReadiness: number;
  // True when the section's data came from AI/heuristic and the
  // broker hasn't touched it. Sections render an info banner.
  aiFilled: boolean;
  // True when the broker has edited at least one field in this
  // section. Set via markSectionDirty in input handlers.
  edited: boolean;
  // Call from any field-edit handler in the section to mark it as
  // broker-touched. Idempotent.
  markSectionDirty: (id: SectionId) => void;
};

// Each section gets the same prop bag and destructures what it needs.
// Components that don't accept extra props (e.g. SourceSummarySection
// only takes `draft`) get them silently ignored by React.
export const SECTION_COMPONENTS: Record<SectionId, ComponentType<SectionRenderProps>> = {
  source: SourceSummarySection as ComponentType<SectionRenderProps>,
  client: ClientSection as ComponentType<SectionRenderProps>,
  entities: PolicyEntitiesSection as ComponentType<SectionRenderProps>,
  insurers: InsurersPoolSection as ComponentType<SectionRenderProps>,
  products: ProductsSection as ComponentType<SectionRenderProps>,
  schema_additions: SchemaAdditionsSection as ComponentType<SectionRenderProps>,
  reconciliation: ReconciliationSection as ComponentType<SectionRenderProps>,
  review: ReviewSection as ComponentType<SectionRenderProps>,
};
