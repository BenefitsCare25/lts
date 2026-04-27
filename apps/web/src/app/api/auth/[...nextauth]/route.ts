// =============================================================
// Auth.js route handler — covers /api/auth/signin, /signout,
// /callback/credentials, /session, /csrf, etc.
// =============================================================

import { handlers } from '@/server/auth/config';

export const { GET, POST } = handlers;
