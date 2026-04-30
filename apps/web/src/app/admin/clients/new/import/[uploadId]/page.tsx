// =============================================================
// /admin/clients/new/import/[uploadId] — wizard host.
//
// Server entry guarded by requireSession; the wizard surface is the
// client-side WizardShell which fetches the ExtractionDraft and
// renders sections. Bookmarkable per uploadId — closing the browser
// mid-wizard and returning resumes from the same draft.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { WizardShell } from './_components/wizard-shell';

export default async function ImportWizardPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  await requireSession();
  const { uploadId } = await params;
  return <WizardShell uploadId={uploadId} />;
}
