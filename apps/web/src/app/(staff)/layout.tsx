import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from '../../components/staff/Sidebar';
import type { StaffUser } from '../../lib/types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

/**
 * Staff shell (slice 5a, upgraded). Real session validation: the layout
 * re-checks the session SERVER-SIDE on every full page load through the
 * same-origin API, then renders the Sidebar with the session user. The
 * redirect lives outside the try/catch on purpose — any API failure (or
 * missing/invalid session) falls through to /login.
 */
async function getSession(): Promise<StaffUser | null> {
  const jar = await cookies();
  try {
    const res = await fetch(`${INTERNAL_API_URL}/staff/session`, {
      headers: { cookie: jar.toString() },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as StaffUser;
  } catch {
    return null;
  }
}

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="staff-shell">
      <Sidebar user={session} />
      <main className="staff-main">{children}</main>
    </div>
  );
}