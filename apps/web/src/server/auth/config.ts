// =============================================================
// Auth.js (NextAuth v5) configuration — single source of truth.
//
// Phase 1 dev path: Credentials provider validates email + password
// against our User table (bcrypt-hashed). JWT sessions, no DB
// adapter — Auth.js owns the cookie, Prisma owns the user row.
//
// When we move to WorkOS (option A in the auth swap discussion),
// this file gets a second provider entry; the rest of the app
// stays put because session shape and helpers are abstracted in
// session.ts.
// =============================================================

import { compare } from 'bcryptjs';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { prisma } from '../db/client';

const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: string;
    } & DefaultSession['user'];
  }
}

// JWT-level fields are accessed via index signatures; the JWT type
// in @auth/core already permits arbitrary keys, so a `declare module`
// augmentation isn't worth the resolution friction in pnpm hoisting.

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Auth.js reads AUTH_SECRET / NEXTAUTH_SECRET from env.
  // AUTH_TRUST_HOST=true is required because we deploy behind
  // Container Apps' ingress, which is not on the auto-trusted list.
  session: { strategy: 'jwt' },
  pages: {
    // Custom credentials form lives at /sign-in. Auth.js's default
    // generated page is fine but we already have the route.
    signIn: '/sign-in',
  },
  providers: [
    Credentials({
      name: 'Email + password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, email: true, role: true, tenantId: true, passwordHash: true },
        });
        // Constant-time-ish: only call compare when both inputs exist.
        if (!user?.passwordHash) return null;

        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          // Carry tenantId + role on the auth user object so the JWT
          // callback can copy them onto the token without a second
          // DB round-trip per request.
          tenantId: user.tenantId,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        // Initial sign-in — copy the fields we need at request time.
        // biome-ignore lint/suspicious/noExplicitAny: NextAuth User type doesn't know about our custom fields
        const u = user as any;
        token.userId = u.id;
        token.tenantId = u.tenantId;
        token.role = u.role;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (!token.tenantId || !token.role) throw new Error('Incomplete session token');
      session.user.id = token.userId as string;
      session.user.tenantId = token.tenantId as string;
      session.user.role = token.role as string;
      return session;
    },
  },
});
