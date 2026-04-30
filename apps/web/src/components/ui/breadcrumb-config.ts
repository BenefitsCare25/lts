// =============================================================
// Breadcrumb registry.
//
// Maps URL segment patterns to display labels. The breadcrumb
// component walks the URL segments and resolves each to a label
// either by:
//   - exact match in `STATIC_LABELS` (e.g. /admin/clients → "Clients")
//   - dynamic resolver (e.g. /admin/clients/<id> → fetch client name)
//
// To add a new entity, register it in `DYNAMIC_RESOLVERS` with a
// segment pattern and an async resolver that returns the label.
// The resolver may run on the client (tRPC fetch) or fall back to
// the segment id if no fetcher is registered.
// =============================================================

export interface BreadcrumbCrumb {
  href: string;
  label: string;
  isCurrent: boolean;
}

export interface BreadcrumbContext {
  segment: string;
  fullPath: string;
  index: number;
  segments: ReadonlyArray<string>;
}

export type DynamicResolver = (ctx: BreadcrumbContext) => string | Promise<string>;

// Static label registry. Keys are exact segment values. Anything
// not in this map falls through to dynamic resolvers (likely an
// id segment).
export const STATIC_LABELS: Readonly<Record<string, string>> = {
  admin: 'Admin',
  clients: 'Clients',
  catalogue: 'Catalogue',
  'employee-schema': 'Employee Schema',
  'product-types': 'Product Types',
  insurers: 'Insurers',
  tpas: 'TPAs',
  pools: 'Pools',
  policies: 'Policies',
  'benefit-years': 'Benefit Years',
  'benefit-groups': 'Benefit Groups',
  products: 'Products',
  plans: 'Plans',
  imports: 'Imports',
  review: 'Review',
  edit: 'Edit',
  employees: 'Employees',
  claims: 'Claims',
  settings: 'Settings',
  'ai-provider': 'AI Provider',
};

// Heuristic: cuid-like ids start with "c" and are ≥ 24 chars of
// alphanumeric. Used as a default for id segments when no resolver
// is registered.
export function isLikelyId(segment: string): boolean {
  return /^c[a-z0-9]{24,}$/i.test(segment) || /^[a-f0-9-]{20,}$/i.test(segment);
}

// Trim long ids to the first 6 chars for fallback display.
export function shortenId(segment: string): string {
  return segment.length > 8 ? `${segment.slice(0, 6)}…` : segment;
}

// Resolve a single segment to a label. Returns the static label
// if registered, the segment itself if not an id, or a shortened
// id otherwise.
export function resolveLabel(ctx: BreadcrumbContext): string {
  const fromStatic = STATIC_LABELS[ctx.segment];
  if (fromStatic) return fromStatic;
  if (isLikelyId(ctx.segment)) return shortenId(ctx.segment);
  // Last-resort: prettify a kebab/snake string.
  return ctx.segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
