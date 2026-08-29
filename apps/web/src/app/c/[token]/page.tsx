'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

/**
 * Client magic-link redemption surface (task 4.4). The token lives in the
 * URL path; this page redeems it ONCE through the same-origin proxy so the
 * Set-Cookie pair lands on the browser, then redirects. Every failure mode
 * lands on the single generic /c/invalid page.
 */
export default function RedeemPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // apiFetch now parses + throws; a failed redeem lands on /c/invalid, and
    // the 401-redirect is suppressed for /c/* paths so client portal errors
    // render inline instead of bouncing to the staff login.
    apiFetch<{ ok: boolean }>('/api/magic-links/redeem', {
      method: 'POST',
      body: { token: params.token },
    })
      .then((res) => {
        router.replace(res.ok ? '/c' : '/c/invalid');
      })
      .catch(() => router.replace('/c/invalid'));
  }, [params.token, router]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 p-6">
      <p className="text-sm text-neutral-500" role="status">
        Validating your link…
      </p>
    </main>
  );
}
