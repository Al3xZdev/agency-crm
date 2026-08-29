'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

/**
 * Client magic-link redemption surface (PR5 restyle). The token lives in the
 * URL path; this page redeems it ONCE through the same-origin proxy so the
 * Set-Cookie pair lands on the browser, then redirects. Every failure mode
 * lands on the single generic /c/invalid page. Same behavior, design-system
 * styling.
 */
export default function RedeemPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="settings-card" style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <i className="ti ti-loader-2" aria-hidden="true" style={{ fontSize: 26, marginBottom: 10 }} />
        <p className="eyebrow" style={{ margin: 0 }}>
          Validando tu vínculo…
        </p>
      </div>
    </div>
  );
}
