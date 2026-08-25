import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Client access' };

const SESSION_COOKIE_NAME = 'agency_session';

/**
 * Landing surface for an ACTIVE client session (task 4.4). Presence-only
 * gate for now: real approval content arrives with later slices, at which
 * point this page must validate the session against the API server-side.
 */
export default async function ClientHomePage() {
  const store = await cookies();
  if (!store.has(SESSION_COOKIE_NAME)) redirect('/c/invalid');

  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">You are signed in</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Your client workspace is ready. Pending approvals will appear here.
        </p>
      </div>
    </main>
  );
}
