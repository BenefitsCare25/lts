// =============================================================
// /admin/clients/[id]/imports/[uploadId] — parse review (S32).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { ImportReviewScreen } from './_components/import-review-screen';

export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string; uploadId: string }>;
}) {
  await requireSession();
  const { id, uploadId } = await params;
  return <ImportReviewScreen clientId={id} uploadId={uploadId} />;
}
