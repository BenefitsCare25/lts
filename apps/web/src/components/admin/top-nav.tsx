'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActiveSection } from './nav-active';

const SECTIONS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Clients', href: '/admin/clients' },
  { label: 'Catalogue', href: '/admin/catalogue' },
  { label: 'Settings', href: '/admin/settings' },
];

export function TopNav() {
  const pathname = usePathname() ?? '/admin';
  return (
    <nav className="app-header__nav" aria-label="Sections">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          className="nav-link"
          href={s.href}
          aria-current={isActiveSection(pathname, s.href) ? 'page' : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
