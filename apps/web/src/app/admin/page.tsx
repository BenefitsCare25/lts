// =============================================================
// /admin landing — redirects to the Clients section.
// =============================================================

import { redirect } from 'next/navigation';

export default function AdminHomePage() {
  redirect('/admin/clients');
}
