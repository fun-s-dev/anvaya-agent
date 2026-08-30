import './globals.css';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Anvaya',
  description: 'Provider-agnostic reconciliation and discrepancy investigation controller',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
