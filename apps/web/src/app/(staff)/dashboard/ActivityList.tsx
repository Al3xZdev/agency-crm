'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { formatRelativeTime } from '../../../lib/format';
import { ActivityItem } from '../../../lib/types';

/**
 * Recent-activity feed (PR5), cursor-paginated. Data: GET /api/dashboard/activity?cursor=&limit=.
 *
 * Backend adaptation: each row is a creative VERSION (id = creativeVersion id,
 * creativeId = owning creative id, status = the version state
 * PROCESSING/READY/FAILED) — not a creative. The
 * endpoint exposes no status query param, so the state chips below filter the
 * already-loaded rows client-side; pagination stays faithful to the cursor.
 */
type VersionStateFilter = 'ALL' | 'PROCESSING' | 'READY' | 'FAILED';

const FILTERS: { value: VersionStateFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PROCESSING', label: 'Procesando' },
  { value: 'READY', label: 'Listos' },
  { value: 'FAILED', label: 'Fallidos' },
];

const STATE_PILL: Record<string, { label: string; className: string }> = {
  // Version state (schema.prisma: PROCESSING/READY/FAILED).
  PROCESSING: { label: 'procesando', className: 'pill processing' },
  READY: { label: 'listo', className: 'pill approved' },
  FAILED: { label: 'fallido', className: 'pill rejected' },
};

interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

export function ActivityList() {
  const [filter, setFilter] = useState<VersionStateFilter>('ALL');
  const router = useRouter();

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', String(20));
      return apiFetch<ActivityPage>(`/api/dashboard/activity?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const allItems = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const items = useMemo(
    () => (filter === 'ALL' ? allItems : allItems.filter((item) => item.status === filter)),
    [allItems, filter],
  );

  return (
    <div>
      <div className="activity-header">
        <div className="eyebrow">Actividad reciente</div>
        <div className="filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? 'chip active' : 'chip'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isError && <div className="error-banner"><span>No pudimos cargar la actividad.</span></div>}

      {!isLoading && items.length === 0 && !isError && (
        <div className="empty-state">
          <i className="ti ti-photo-off" aria-hidden="true" />
          <p>No hay versiones con este estado todavía.</p>
        </div>
      )}

      {(isLoading || items.length > 0) && (
        <div className="list-card">
          <div className="list-row list-head">
            <div>Creativo</div>
            <div>Cliente</div>
            <div>Versión</div>
            <div>Estado</div>
            <div>Hace</div>
          </div>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="list-row skeleton-row" />)}
          {items.map((item) => {
            const pill = STATE_PILL[item.status] ?? {
              label: item.status.toLowerCase(),
              className: 'pill processing',
            };
            return (
              <div
                key={item.id}
                className="list-row list-row-clickable"
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/creatives/${item.creativeId}`)}
                onKeyDown={(e) => e.key === 'Enter' && router.push(`/creatives/${item.creativeId}`)}
              >
                <div>{item.creativeName}</div>
                <div className="muted">{item.clientName}</div>
                <div className="mono">v{item.versionNumber}</div>
                <div>
                  <span className={pill.className}>{pill.label}</span>
                </div>
                <div className="mono">{formatRelativeTime(item.updatedAt)}</div>
              </div>
            );
          })}
        </div>
      )}

      {hasNextPage && (
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
    </div>
  );
}
