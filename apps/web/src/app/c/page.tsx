'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { apiFetch, apiJson } from '../../lib/api';

interface MeResponse {
  clientName: string;
}

interface CreativeRow {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  latestVersionId: string;
  latestVersionNo: number;
  reviewStatus: string;
}

function kindIcon(kind: CreativeRow['kind']): string {
  switch (kind) {
    case 'IMAGE':
      return '\u{1F5BC}';
    case 'VIDEO':
      return '\u{1F3AC}';
    case 'TEXT':
      return '\u{1F4DD}';
  }
}

/** Client-facing pill mapping (review status of the latest version). */
function statusPill(status: string): { label: string; className: string } {
  switch (status) {
    case 'PENDING_REVIEW':
      return { label: 'pending review', className: 'pill pending' };
    case 'APPROVED':
      return { label: 'approved', className: 'pill approved' };
    case 'REJECTED':
      return { label: 'rejected', className: 'pill rejected' };
    case 'CHANGES_REQUESTED':
      return { label: 'changes requested', className: 'pill pending' };
    default:
      return { label: status.replace(/_/g, ' ').toLowerCase(), className: 'pill processing' };
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

  const clientName = me.data?.clientName ?? 'there';
  const items = creatives.data ?? [];

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '36px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22 }}>Welcome, {clientName}</h1>
          <p className="eyebrow" style={{ margin: '4px 0 0' }}>
            creativos para revisar
          </p>
        </div>
        <button className="btn ghost" onClick={handleLogout}>
          <i className="ti ti-logout" aria-hidden="true" />
          Sign out
        </button>
      </div>

      {creatives.isLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 28 }}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton-row" style={{ height: 160, borderRadius: 6 }} />
          ))}
        </div>
      )}

      {creatives.isError && (
        <div className="error-banner" style={{ marginTop: 28 }}>
          <span>Failed to load creatives. Please try again.</span>
        </div>
      )}

      {!creatives.isLoading && !creatives.isError && items.length === 0 && (
        <div className="empty-state" style={{ marginTop: 28 }}>
          <i className="ti ti-photo-off" aria-hidden="true" />
          <p>No creatives pending review.</p>
        </div>
      )}

      {!creatives.isLoading && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 28 }}>
          {items.map((c) => {
            const pill = statusPill(c.reviewStatus);
            return (
              <Link
                key={c.id}
                href={`/c/versions/${c.latestVersionId}`}
                className="client-card"
                style={{ textDecoration: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{kindIcon(c.kind)}</span>
                  <div className="client-card-name">{c.title}</div>
                </div>
                <div className="client-card-meta" style={{ marginTop: 6 }}>
                  Version {c.latestVersionNo}
                </div>
                <span className={pill.className} style={{ marginTop: 12 }}>
                  {pill.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
