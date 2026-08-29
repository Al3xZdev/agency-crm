'use client';

import type { ReactNode } from 'react';

/**
 * Client portal shell (PR5 restyle). Uses the shared design system tokens
 * (paper background, sans/display fonts) instead of the old Tailwind-neutral
 * palette. Renders outside the (staff) shell, so session stays CLIENT-scoped.
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--paper)',
        color: 'var(--text)',
        fontFamily: 'var(--sans)',
      }}
    >
      <header
        style={{
          borderBottom: '1px solid var(--paper-line)',
          background: 'var(--paper-2)',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--display)',
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--text)',
          }}
        >
          Agency Proofing
        </span>
        <span className="eyebrow" style={{ marginLeft: 'auto' }}>
          portal de cliente
        </span>
      </header>
      {children}
    </div>
  );
}
