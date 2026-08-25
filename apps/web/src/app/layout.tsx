import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Ad Approval Hub',
  description: 'Agency creative review and approval workspace.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Belt-and-braces alongside fetch-level referrerPolicy: magic-link
            URLs must never travel in any Referer header. */}
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>{children}</body>
    </html>
  );
}
