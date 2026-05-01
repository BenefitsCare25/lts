// =============================================================
// AdminAside — client wrapper around the section rail that auto-
// collapses on wizard routes.
//
// The wizard pages (Create-client import flow) ship their own
// vertical-stepper rail; the outer "Clients / All clients / New
// client" section rail becomes redundant noise that wastes ~232px
// of horizontal real estate. We hide it whenever the user is on a
// wizard route. Top-nav (Clients / Catalogue / Settings) is still
// available for navigation away.
//
// Auto-only: no manual toggle. The rail comes back the moment the
// broker leaves the wizard.
// =============================================================

'use client';

import { SectionRail } from '@/components/admin/section-rail';
import { usePathname } from 'next/navigation';

// Routes whose pages already render a left-rail of their own.
// Add new wizards here as they ship.
const COLLAPSED_RAIL_ROUTES: ReadonlyArray<RegExp> = [
  /^\/admin\/clients\/new\/import\//, // Create-client import wizard
];

function isCollapsedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return COLLAPSED_RAIL_ROUTES.some((re) => re.test(pathname));
}

export function AdminAside() {
  const pathname = usePathname();
  const collapsed = isCollapsedRoute(pathname);
  return (
    <aside
      className={collapsed ? 'admin-aside is-collapsed' : 'admin-aside'}
      aria-hidden={collapsed || undefined}
    >
      <SectionRail />
    </aside>
  );
}
