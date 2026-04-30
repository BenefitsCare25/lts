'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { isActiveSection } from './nav-active';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly exact?: boolean;
}

const CATALOGUE_NAV: ReadonlyArray<NavItem> = [
  { label: 'Employee Schema', href: '/admin/catalogue/employee-schema' },
  { label: 'Product Types', href: '/admin/catalogue/product-types' },
  { label: 'Insurers', href: '/admin/catalogue/insurers' },
  { label: 'TPAs', href: '/admin/catalogue/tpas' },
  { label: 'Pools', href: '/admin/catalogue/pools' },
];

const SETTINGS_NAV: ReadonlyArray<NavItem> = [
  { label: 'AI Provider', href: '/admin/settings/ai-provider' },
];

function StaticRail({
  heading,
  items,
  pathname,
}: {
  heading: string;
  items: ReadonlyArray<NavItem>;
  pathname: string;
}) {
  return (
    <nav className="admin-rail" aria-label={heading}>
      <p className="admin-rail__heading">{heading}</p>
      <div className="admin-rail__group">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="admin-rail__link"
            aria-current={isActiveSection(pathname, item.href, item.exact) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ClientsListRail({ pathname }: { pathname: string }) {
  return (
    <nav className="admin-rail" aria-label="Clients">
      <p className="admin-rail__heading">Clients</p>
      <div className="admin-rail__group">
        <Link
          href="/admin/clients"
          className="admin-rail__link"
          aria-current={pathname === '/admin/clients' ? 'page' : undefined}
        >
          All clients
        </Link>
      </div>
    </nav>
  );
}

function ClientDetailRail({ clientId, pathname }: { clientId: string; pathname: string }) {
  const client = trpc.clients.byId.useQuery({ id: clientId });
  const heading = client.data?.tradingName ?? client.data?.legalName ?? 'Client';

  const items: ReadonlyArray<NavItem> = [
    { label: 'Policies', href: `/admin/clients/${clientId}/policies` },
    { label: 'Imports', href: `/admin/clients/${clientId}/imports` },
    { label: 'Employees', href: `/admin/clients/${clientId}/employees` },
    { label: 'Claims', href: `/admin/clients/${clientId}/claims` },
    { label: 'Edit details', href: `/admin/clients/${clientId}/edit`, exact: true },
  ];

  return (
    <nav className="admin-rail" aria-label="Client navigation">
      <Link href="/admin/clients" className="admin-rail__back">
        ← All clients
      </Link>
      <p className="admin-rail__title" title={client.data?.legalName ?? undefined}>
        {heading}
      </p>
      <div className="admin-rail__group">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="admin-rail__link"
            aria-current={isActiveSection(pathname, item.href, item.exact) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ClientsRail({ pathname }: { pathname: string }) {
  // useParams reads dynamic segments matched on the current route. On a
  // client subroute the `id` segment is the clientId; on /admin/clients
  // (the list page) it's undefined, so we render the list rail instead.
  const params = useParams<{ id?: string }>();
  const clientId = params.id;
  if (!clientId) return <ClientsListRail pathname={pathname} />;
  return <ClientDetailRail clientId={clientId} pathname={pathname} />;
}

export function SectionRail() {
  const pathname = usePathname() ?? '/admin';
  if (pathname.startsWith('/admin/clients')) return <ClientsRail pathname={pathname} />;
  if (pathname.startsWith('/admin/catalogue'))
    return <StaticRail heading="Catalogue" items={CATALOGUE_NAV} pathname={pathname} />;
  if (pathname.startsWith('/admin/settings'))
    return <StaticRail heading="Settings" items={SETTINGS_NAV} pathname={pathname} />;
  return null;
}
