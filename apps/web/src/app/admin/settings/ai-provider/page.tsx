// =============================================================
// /admin/settings/ai-provider — Azure AI Foundry credential
// management for this tenant.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { AiProviderScreen } from './_components/ai-provider-screen';

export default async function AiProviderPage() {
  await requireSession();
  return <AiProviderScreen />;
}
