'use client';

import type { ReactNode } from 'react';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-6 py-3">
        <span className="text-sm font-semibold text-neutral-900">Client Portal</span>
      </header>
      {children}
    </div>
  );
}
