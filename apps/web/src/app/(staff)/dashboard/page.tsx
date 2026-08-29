'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { DashboardStats } from '../../../lib/types';
import { StatCard } from '../../../components/staff/StatCard';
import { ActivityList } from './ActivityList';

/**
 * Staff dashboard (PR5). Data: GET /api/dashboard/stats → 4 StatCards.
 * Loading skeleton, error banner with retry, and the ActivityList feed below.
 */
export default function DashboardPage() {
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiFetch<DashboardStats>('/api/dashboard/stats'),
  });

  return (
    <div>
      <div className="staff-topbar">
        <h2>Dashboard</h2>
        <button className="btn ghost" onClick={() => refetch()} disabled={isFetching}>
          <i className={isFetching ? 'ti ti-loader-2' : 'ti ti-refresh'} aria-hidden="true" />
          {isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {isError && (
        <div className="error-banner">
          <span>No pudimos cargar las estadísticas.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      <div className="stat-grid">
        <StatCard value={stats?.pendingReview ?? 0} label="Pendientes de revisión" loading={isLoading} />
        <StatCard value={stats?.approvedThisWeek ?? 0} label="Aprobados esta semana" loading={isLoading} />
        <StatCard value={stats?.activeClients ?? 0} label="Clientes activos" loading={isLoading} />
        <StatCard value={stats?.unresolvedComments ?? 0} label="Comentarios sin resolver" loading={isLoading} />
      </div>

      <ActivityList />
    </div>
  );
}
