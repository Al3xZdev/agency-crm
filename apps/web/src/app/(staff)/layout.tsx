import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

const SESSION_COOKIE = 'agency_session';

/**
 * Staff shell (slice 5a). Presence-only gate — the same convention as the
 * client /c surface: full session validation stays server-side in the API;
 * every data fetch re-checks auth and tenants there.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) redirect('/login');

  return (
    <>
      <nav style={{ display: 'flex', gap: 16, padding: '12px 24px', borderBottom: '1px solid #ddd' }}>
        <strong>Ad Approval Hub</strong>
        <Link href="/clients">Clients</Link>
      </nav>
      <main style={{ padding: 24 }}>{children}</main>
    </>
  );
}
