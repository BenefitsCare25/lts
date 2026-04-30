// =============================================================
// Breadcrumbs — auto-generated from the current URL.
//
// Walks the URL segments, builds (href, label) pairs using the
// breadcrumb-config registry, and renders them as a horizontal
// trail. Excludes the leading "/admin" segment (it's the brand).
//
// Client component because it reads `usePathname()`. Renders a
// stable structure (no async data fetches) so it stays cheap on
// every navigation.
//
// Future: a v2 can plug in tRPC resolvers per segment to show
// "Clients › STMicroelectronics" instead of "Clients › cabc12…".
// Today's id-fallback is acceptable because most breadcrumbs only
// go 2-3 levels deep.
// =============================================================

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import { resolveLabel, type BreadcrumbCrumb } from './breadcrumb-config';

interface BreadcrumbsProps {
  // Optional override map: { [segment]: label }. Use when the
  // page already has the canonical name in hand (avoids a fetch).
  overrides?: Readonly<Record<string, string>>;
}

export function Breadcrumbs({ overrides }: BreadcrumbsProps) {
  const pathname = usePathname() ?? '/';
  // Strip leading slash, drop empty segments.
  const segments = pathname.split('/').filter(Boolean);

  // Hide the breadcrumbs entirely on /admin (root) — there is
  // nothing above it.
  if (segments.length <= 1) return null;

  const crumbs: BreadcrumbCrumb[] = segments.map((segment, index) => {
    const fullPath = `/${segments.slice(0, index + 1).join('/')}`;
    const label =
      overrides?.[segment] ??
      resolveLabel({ segment, fullPath, index, segments });
    return {
      href: fullPath,
      label,
      isCurrent: index === segments.length - 1,
    };
  });

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.href}>
          {i > 0 ? <span aria-hidden className="breadcrumbs__sep">›</span> : null}
          {crumb.isCurrent ? (
            <span aria-current="page" className="breadcrumbs__current">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href}>{crumb.label}</Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
