'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { CampaignDetail } from '../../../../lib/types';
import { StatusPill } from '../../../../components/staff/StatusPill';
import { CampaignStatusPill } from '../../../../components/staff/CampaignStatusPill';
import { CreateCreativeModal } from '../../../../components/staff/CreateCreativeModal';

const TYPE_ICON = { IMAGE: 'photo', VIDEO: 'video', TEXT: 'align-left' } as const;

const STATUS_OPTIONS: { value: CampaignDetail['status']; label: string }[] = [
  { value: 'ACTIVE', label: 'Activar' },
  { value: 'PAUSED', label: 'Pausar' },
  { value: 'ARCHIVED', label: 'Archivar' },
];

/**
 * Campaign detail (PR4). Data: GET /api/campaigns/:id — list item plus
 * `creatives: CreativeSummary[]` (title/kind/currentVersionNo). Status is
 * patched via PATCH /api/campaigns/:id `{ status }`; creatives are created
 * via POST /api/campaigns/:campaignId/creatives (nested).
 */
export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const [showCreateCreative, setShowCreateCreative] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: campaign, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => apiFetch<CampaignDetail>(`/api/campaigns/${campaignId}`),
  });

  const updateStatus = useMutation({
    mutationFn: (status: CampaignDetail['status']) =>
      apiFetch<CampaignDetail>(`/api/campaigns/${campaignId}`, { method: 'PATCH', body: { status } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['campaign', campaignId], updated);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setStatusMenuOpen(false);
      setStatusError(null);
    },
    onError: (err) => {
      setStatusError(err instanceof ApiError ? err.message : 'No pudimos cambiar el estado.');
    },
  });

  if (isError) {
    return (
      <div className="error-banner">
        <span>No pudimos cargar esta campaña.</span>
        <button onClick={() => refetch()}>Reintentar</button>
      </div>
    );
  }

  if (isLoading || !campaign) {
    return <div className="client-header skeleton-row" style={{ height: 90 }} />;
  }

  return (
    <div>
      <div className="breadcrumb">
        <button className="link-btn" onClick={() => router.push(`/clients/${campaign.clientId}`)}>
          {campaign.clientName}
        </button>
        {' / '}
        {campaign.name}
      </div>

      <div className="client-header">
        <div className="client-id">
          <div>
            <h3>{campaign.name}</h3>
            <div className="eyebrow">{campaign.creatives.length} creativos</div>
          </div>
        </div>
        <div className="status-menu-wrap">
          <button className="btn" onClick={() => setStatusMenuOpen((s) => !s)}>
            <CampaignStatusPill status={campaign.status} />
            <i className="ti ti-chevron-down" aria-hidden="true" />
          </button>
          {statusMenuOpen && (
            <>
              <div className="status-menu-backdrop" onClick={() => setStatusMenuOpen(false)} />
              <div className="status-menu">
                {STATUS_OPTIONS.filter((o) => o.value !== campaign.status).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateStatus.mutate(option.value)}
                    disabled={updateStatus.isPending}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {statusError && (
        <div className="error-banner">
          <span>{statusError}</span>
        </div>
      )}

      <div className="staff-topbar" style={{ marginBottom: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 0 }}>
          Creativos de la campaña
        </div>
        <button className="btn primary" onClick={() => setShowCreateCreative(true)}>
          <i className="ti ti-plus" aria-hidden="true" />
          Nuevo creativo
        </button>
      </div>

      {campaign.creatives.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-photo-off" aria-hidden="true" />
          <p>Esta campaña todavía no tiene creativos. Creá el primero.</p>
        </div>
      )}

      <div className="contact-sheet">
        {campaign.creatives.map((creative, i) => (
          <button
            key={creative.id}
            className="frame"
            onClick={() => router.push(`/creatives/${creative.id}`)}
          >
            <div className="frame-thumb">
              <span className="idx">{String(i + 1).padStart(3, '0')}</span>
              <i className={`ti ti-${TYPE_ICON[creative.kind]}`} aria-hidden="true" />
            </div>
            <div className="frame-meta">
              <div className="name">{creative.title}</div>
              <div className="row">
                <span className="mono">v{creative.currentVersionNo}</span>
                <StatusPill status={creative.status} />
              </div>
            </div>
          </button>
        ))}
      </div>

      {showCreateCreative && (
        <CreateCreativeModal
          campaignId={campaign.id}
          onClose={() => setShowCreateCreative(false)}
          onCreated={(creative) => router.push(`/upload/${creative.id}`)}
        />
      )}
    </div>
  );
}
