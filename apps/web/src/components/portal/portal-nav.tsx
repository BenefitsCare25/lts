'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/portal', label: 'Dashboard', exact: true },
  { href: '/portal/benefits', label: 'Benefits', exact: false },
  { href: '/portal/dependents', label: 'Dependents', exact: false },
  { href: '/portal/profile', label: 'Profile', exact: false },
  { href: '/portal/documents', label: 'Documents', exact: false },
] as const;

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="portal-nav">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`portal-nav__link${active ? ' portal-nav__link--active' : ''}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
