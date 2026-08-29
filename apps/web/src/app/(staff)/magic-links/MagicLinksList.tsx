'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { MagicLinkListItem } from '../../../lib/types';
import { MagicLink } from '../../../components/staff/MagicLink';
import { GenerateLinkModal } from '../../../components/staff/GenerateLinkModal';

/**
 * Magic links list (PR5). Data: GET /api/magic-links?clientId=&status=active|revoked.
 * SUPER_ADMIN/ACCOUNT_MANAGER only (the sidebar gates the link for other roles).
 *
 * Backend adaptation: the endpoint exposes a `status=active|revoked` query
 * filter derived from `revokedAt` (active = revokedAt IS NULL), so the status
 * chips map 1:1 to that param. Each row renders the existing MagicLink
 * component, which keeps the no-copy-button security property (the raw token
 * is never persisted) and revokes via POST /api/magic-links/:id/revoke.
 */
type StatusFilter = 'ALL' | 'active' | 'revoked';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'revoked', label: 'Revocados' },
];

export function MagicLinksList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== 'ALL') p.set('status', statusFilter);
    return p.toString();
  }, [statusFilter]);

  const { data: links, isLoading, isError, refetch } = useQuery({
    queryKey: ['magic-links', statusFilter],
    queryFn: () => apiFetch<MagicLinkListItem[]>(`/api/magic-links${params ? `?${params}` : ''}`),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return links ?? [];
    return (links ?? []).filter((link) => link.clientName.toLowerCase().includes(term));
  }, [links, search]);

  return (
    <div>
      <div className="clients-toolbar">
        <div className="search-input">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn primary" onClick={() => setShowGenerateModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" />
          Generar link
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
          <span>No pudimos cargar los links mágicos.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      {!isLoading && filtered.length === 0 && !isError && (
        <div className="empty-state">
          <i className="ti ti-link-off" aria-hidden="true" />
          <p>No hay links mágicos con este filtro.</p>
        </div>
      )}

      {(isLoading || filtered.length > 0) && (
        <div className="list-card">
          <div className="list-row link-row list-head">
            <div>Cliente</div>
            <div>Creado</div>
            <div>Último uso</div>
            <div>Estado</div>
            <div></div>
          </div>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="list-row skeleton-row" />)}
          {filtered.map((link) => (
            <MagicLink key={link.id} link={link} />
          ))}
        </div>
      )}

      {showGenerateModal && <GenerateLinkModal onClose={() => setShowGenerateModal(false)} />}
    </div>
  );
}
