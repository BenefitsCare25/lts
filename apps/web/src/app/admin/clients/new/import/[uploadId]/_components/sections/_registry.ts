// =============================================================
// Section registry — single source of truth for the wizard's
// left-rail nav, shared form state shape, and the section→component
// dispatch table consumed by the shell.
//
// Adding a new section: append a row to SECTIONS, write the matching
// component under sections/, register it in SECTION_COMPONENTS in
// section-components.ts. The shell renders by id without any ternary
// dispatch.
// =============================================================

export type SectionId =
  | 'source'
  | 'client'
  | 'entities'
  | 'benefit_year'
  | 'insurers'
  | 'products'
  | 'eligibility'
  | 'schema_additions'
  | 'reconciliation'
  | 'review';

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'source', label: 'Source file' },
  { id: 'client', label: 'Client details' },
  { id: 'entities', label: 'Policy entities' },
  { id: 'benefit_year', label: 'Benefit year' },
  { id: 'insurers', label: 'Insurers & pool' },
  { id: 'products', label: 'Products' },
  { id: 'eligibility', label: 'Benefit groups' },
  { id: 'schema_additions', label: 'Schema additions' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'review', label: 'Review & apply' },
];

// Form shape — kept in the shell, threaded to sections that need it.
// Sections that are read-only (source, products, etc.) take the draft
// straight off tRPC and don't touch form.
export type DraftFormState = {
  client: {
    legalName: string;
    tradingName: string;
    uen: string;
    countryOfIncorporation: string;
    address: string;
    industry: string;
    primaryContactName: string;
    primaryContactEmail: string;
  };
  policyEntities: Array<{
    legalName: string;
    policyNumber: string;
    address: string;
    headcountEstimate: number | null;
    isMaster: boolean;
  }>;
  policy: {
    name: string;
    ageBasis: 'POLICY_START' | 'HIRE_DATE' | 'AS_AT_EVENT';
  };
  benefitYear: {
    startDate: string; // yyyy-mm-dd
    endDate: string; // yyyy-mm-dd
    carryForwardFromYearId: string | null;
  };
};

export function emptyDraftFormState(): DraftFormState {
  return {
    client: {
      legalName: '',
      tradingName: '',
      uen: '',
      countryOfIncorporation: 'SG',
      address: '',
      industry: '',
      primaryContactName: '',
      primaryContactEmail: '',
    },
    policyEntities: [],
    policy: {
      name: '',
      ageBasis: 'POLICY_START',
    },
    benefitYear: {
      startDate: '',
      endDate: '',
      carryForwardFromYearId: null,
    },
  };
}
