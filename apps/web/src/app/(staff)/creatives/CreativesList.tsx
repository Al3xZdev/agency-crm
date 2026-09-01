'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { CreativeKind, CreativeListItem, CreativeStatus } from '../../../lib/types';

const STATUS_FILTERS: { value: CreativeStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'PROCESSING', label: 'Procesando' },
  { value: 'IN_REVIEW', label: 'En revisión' },
  { value: 'CHANGES_REQUESTED', label: 'Cambios solicitados' },
  { value: 'APPROVED', label: 'Aprobados' },
  { value: 'REJECTED', label: 'No aprobados' },
  { value: 'UPLOAD_FAILED', label: 'Subida fallida' },
];

const KIND_FILTERS: { value: CreativeKind | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todos los formatos' },
  { value: 'IMAGE', label: 'Imagen' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'TEXT', label: 'Texto' },
];

const STATUS_PILL: Record<CreativeStatus, { label: string; className: string }> = {
  APPROVED: { label: 'aprobado', className: 'pill approved' },
  DRAFT: { label: 'borrador', className: 'pill camp-archived' },
  REJECTED: { label: 'No aprobado', className: 'pill camp-paused' },
  PROCESSING: { label: 'procesando', className: 'pill processing' },
  IN_REVIEW: { label: 'en revisión', className: 'pill processing' },
  CHANGES_REQUESTED: { label: 'cambios solicitados', className: 'pill processing' },
  UPLOAD_FAILED: { label: 'subida fallida', className: 'pill processing' },
};

const KIND_LABEL: Record<CreativeKind, string> = {
  IMAGE: 'Imagen',
  VIDEO: 'Video',
  TEXT: 'Texto',
};

/**
 * Creatives flat list (GET /api/creatives). The backend supports `?search=`,
 * `?status=` and `?kind=` query filters; we send them so filtering matches the
 * repo vocabulary (DRAFT/IN_REVIEW/CHANGES_REQUESTED, not the reference's WIP
 * PENDING/REQUEST_CHANGES). Rows navigate to the existing /creatives/[id]
 * detail page.
 */
export function CreativesList() {
  const [statusFilter, setStatusFilter] = useState<CreativeStatus | 'ALL'>('ALL');
  const [kindFilter, setKindFilter] = useState<CreativeKind | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: creatives, isLoading, isError, refetch } = useQuery({
    queryKey: ['creatives', statusFilter, kindFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (kindFilter !== 'ALL') params.set('kind', kindFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const qs = params.toString();
      return apiFetch<CreativeListItem[]>(`/api/creatives${qs ? `?${qs}` : ''}`);
    },
  });

  return (
    <div>
      <div className="clients-toolbar">
        <div className="search-input">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por título…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-row" style={{ marginBottom: 16 }}>
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            className={kindFilter === f.value ? 'chip active' : 'chip'}
            onClick={() => setKindFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
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
          <span>No pudimos cargar los creativos.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      {!isLoading && !isError && creatives?.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-photo" aria-hidden="true" />
          <p>No hay creativos que coincidan con este filtro.</p>
        </div>
      )}

      {(isLoading || (creatives && creatives.length > 0)) && (
        <div className="list-card">
          <div className="list-row creatives-row list-head">
            <div>Título</div>
            <div>Cliente</div>
            <div>Campaña</div>
            <div>Tipo</div>
            <div>Estado</div>
            <div>Actualizado</div>
          </div>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="list-row skeleton-row" />)}
          {creatives?.map((creative) => (
            <div
              key={creative.id}
              className="list-row creatives-row list-row-clickable"
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/creatives/${creative.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/creatives/${creative.id}`)}
            >
              <div className="creative-name-cell">{creative.title}</div>
              <div className="muted">{creative.clientName}</div>
              <div className="muted">{creative.campaignName}</div>
              <div className="mono">{KIND_LABEL[creative.kind]}</div>
              <div>
                <span className={STATUS_PILL[creative.status].className}>
                  {STATUS_PILL[creative.status].label}
                </span>
              </div>
              <div className="mono">{dateLabel(creative.updatedAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
