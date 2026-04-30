// Returns true when `pathname` is `href` itself or a sub-route of it.
// `exact` opts out of subtree matching — use only for sibling routes
// that share a parent (e.g. /a/edit alongside /a/policies).
export function isActiveSection(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
