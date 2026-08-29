'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { ClientDetail } from '../../../../lib/types';
import { CampaignStatusPill } from '../../../../components/staff/CampaignStatusPill';

/**
 * Client detail (PR4). Data: GET /api/clients/:id — returns the client plus
 * `campaigns: CampaignSummary[]`, `activeCampaigns` and `totalCreatives`
 * (PR2 detail). There is no client-creatives list endpoint, so the page shows
 * the client's campaigns as a grid of cards (name + status + creativesCount).
 */
export function ClientDetailView({ clientId }: { clientId: string }) {
  const router = useRouter();

  const { data: client, isLoading, isError, refetch } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => apiFetch<ClientDetail>(`/api/clients/${clientId}`),
  });

  if (isError) {
    return (
      <div className="error-banner">
        <span>No pudimos cargar este cliente.</span>
        <button onClick={() => refetch()}>Reintentar</button>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumb">
        <button className="link-btn" onClick={() => router.push('/clients')}>
          Clientes
        </button>
        {' / '}
        {isLoading ? '…' : client?.name}
      </div>

      <div className="client-header">
        <div className="client-id">
          <div className="avatar">{isLoading ? '' : initials(client?.name ?? '')}</div>
          <div>
            <h3>{isLoading ? 'Cargando…' : client?.name}</h3>
            <div className="eyebrow">
              {isLoading || !client
                ? ''
                : `${client.activeCampaigns} campañas activas · ${client.totalCreatives} creativos`}
            </div>
            {client?.email && <div className="mono" style={{ color: 'var(--text-dim)' }}>{client.email}</div>}
          </div>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 12, marginTop: 24 }}>
        Campañas
      </div>

      {!isLoading && client && client.campaigns.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-bullhorn-off" aria-hidden="true" />
          <p>Este cliente todavía no tiene campañas.</p>
        </div>
      )}

      <div className="contact-sheet">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="frame skeleton-row" />)}
        {client?.campaigns.map((campaign, i) => (
          <button
            key={campaign.id}
            className="frame"
            onClick={() => router.push(`/campaigns/${campaign.id}`)}
          >
            <div className="frame-thumb">
              <span className="idx">{String(i + 1).padStart(3, '0')}</span>
              <i className="ti ti-bullhorn" aria-hidden="true" />
            </div>
            <div className="frame-meta">
              <div className="name">{campaign.name}</div>
              <div className="row">
                <span className="mono">{campaign.creativesCount} creativos</span>
                <CampaignStatusPill status={campaign.status} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}
