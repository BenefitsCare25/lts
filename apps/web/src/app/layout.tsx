import { TrpcProvider } from '@/lib/trpc/provider';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Insurance SaaS Platform',
  description: 'Multi-agency white-label insurance brokerage SaaS — Phase 1 admin',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
