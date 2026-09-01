'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { apiFetch, apiJson } from '../../lib/api';
import { StatusPill } from '../../components/staff/StatusPill';

interface MeResponse {
  clientName: string;
}

interface CreativeRow {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  latestVersionId: string | null;
  latestVersionNo: number | null;
  reviewStatus: string | null;
}

type DecidedStatus = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

const REVIEW_STATUS: Record<string, boolean> = {
  APPROVED: true,
  REJECTED: true,
  CHANGES_REQUESTED: true,
};

function kindIcon(kind: CreativeRow['kind']): string {
  switch (kind) {
    case 'IMAGE':
      return 'ti-photo';
    case 'VIDEO':
      return 'ti-video';
    case 'TEXT':
      return 'ti-align-left';
  }
}

export default function ClientDashboard() {
  const router = useRouter();

  const me = useQuery({
    queryKey: ['c-me'],
    queryFn: () => apiJson<MeResponse>('/api/c/me'),
  });

  const creatives = useQuery({
    queryKey: ['c-creatives'],
    queryFn: () => apiJson<CreativeRow[]>('/api/c/creatives'),
  });

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.replace('/c/invalid');
  }

  const items = creatives.data ?? [];

  // Items with a ready version (latestVersionId set) and no review decision yet.
  const pending = items.filter((c) => c.latestVersionId && c.reviewStatus === 'NONE');

  // Items with a ready version whose review has been decided.
  const history = items.filter(
    (c) => c.latestVersionId && c.reviewStatus != null && REVIEW_STATUS[c.reviewStatus],
  );

  return (
    <main className="client-shell">
      <div className="client-topbar">
        <div className="brand">{me.data?.clientName ?? '…'}</div>
        <div className="who">sesión de revisión</div>
        <button className="btn ghost" onClick={handleLogout}>
          <i className="ti ti-logout" aria-hidden="true" />
          Salir
        </button>
      </div>

      <div className="client-body">
        <h2>Pendientes de tu revisión</h2>

        {creatives.isLoading && (
          <div className="review-grid">
            {[1, 2, 3].map((n) => (
              <div key={n} className="review-card skeleton-row" style={{ height: 150 }} />
            ))}
          </div>
        )}

        {creatives.isError && (
          <div className="error-banner">
            <span>No pudimos cargar los creativos. Volvé a intentar.</span>
            <button onClick={() => creatives.refetch()}>Reintentar</button>
          </div>
        )}

        {!creatives.isLoading && !creatives.isError && pending.length === 0 && (
          <div className="empty-state">
            <i className="ti ti-circle-check" aria-hidden="true" />
            <p>No tenés creativos pendientes de revisión.</p>
          </div>
        )}

        {!creatives.isLoading && !creatives.isError && pending.length > 0 && (
          <div className="review-grid">
            {pending.map((c) => (
              <div key={c.id} className="review-card">
                <div className="thumb">
                  <i className={`ti ${kindIcon(c.kind)}`} aria-hidden="true" />
                </div>
                <div className="body">
                  <div className="campaign">Versión {c.latestVersionNo}</div>
                  <div className="name">{c.title}</div>
                  <Link className="btn primary" href={`/c/versions/${c.latestVersionId}`}>
                    Revisar
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {!creatives.isLoading && !creatives.isError && history.length > 0 && (
          <>
            <h2>Historial</h2>
            {history.map((c) => (
              <button
                key={c.id}
                className="hist-row"
                onClick={() => router.push(`/c/versions/${c.latestVersionId}`)}
              >
                <span>
                  {c.title} · v{c.latestVersionNo}
                </span>
                {c.reviewStatus ? <StatusPill status={c.reviewStatus as DecidedStatus} /> : null}
              </button>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
