'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { Campaign } from '../../../lib/types';
import { CampaignStatusPill } from '../../../components/staff/CampaignStatusPill';
import { CreateCampaignModal } from '../../../components/staff/CreateCampaignModal';

const STATUS_FILTERS: { value: Campaign['status'] | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'ACTIVE', label: 'Activas' },
  { value: 'PAUSED', label: 'Pausadas' },
  { value: 'ARCHIVED', label: 'Archivadas' },
];

/**
 * Campaigns flat list (PR4). Data: GET /api/campaigns with `?status=` and
 * `?search=` — the PR2 flat endpoint joins clientName and counts creatives.
 */
export function CampaignsList() {
  const [statusFilter, setStatusFilter] = useState<Campaign['status'] | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: campaigns, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaigns', statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiFetch<Campaign[]>(`/api/campaigns?${params.toString()}`);
    },
  });

  return (
    <div>
      <div className="clients-toolbar">
        <div className="search-input">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar campaña o cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn primary" onClick={() => setShowCreateModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" />
          Nueva campaña
        </button>
      </div>

      <div className="filter-row" style={{ marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            className={statusFilter === f.value ? 'chip active' : 'chip'}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isError && (
        <div className="error-banner">
          <span>No pudimos cargar las campañas.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      {!isLoading && campaigns?.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-speakerphone" aria-hidden="true" />
          <p>No hay campañas que coincidan con este filtro.</p>
        </div>
      )}

      {(isLoading || (campaigns && campaigns.length > 0)) && (
        <div className="list-card">
          <div className="list-row campaign-row list-head">
            <div>Campaña</div>
            <div>Cliente</div>
            <div>Creativos</div>
            <div>Estado</div>
          </div>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="list-row skeleton-row" />)}
          {campaigns?.map((campaign) => (
            <div
              key={campaign.id}
              className="list-row campaign-row list-row-clickable"
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/campaigns/${campaign.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/campaigns/${campaign.id}`)}
            >
              <div>{campaign.name}</div>
              <div className="muted">{campaign.clientName}</div>
              <div className="mono">{campaign.creativesCount}</div>
              <div>
                <CampaignStatusPill status={campaign.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateCampaignModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(campaign) => {
            setShowCreateModal(false);
            router.push(`/campaigns/${campaign.id}`);
          }}
        />
      )}
    </div>
  );
}
