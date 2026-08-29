'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { Client } from '../../../lib/types';
import { CreateClientModal } from '../../../components/staff/CreateClientModal';

/**
 * Clients grid (PR4). Data: GET /api/clients — the backend flat list returns
 * `{ id, name, email, contact, createdAt }` (no per-client campaign counts on
 * the list endpoint), so the cards show name / email / contact and search
 * filters the already-loaded rows client-side.
 */
export function ClientsGrid() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: clients, isLoading, isError, refetch } = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/api/clients'),
  });

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return clients ?? [];
    return (clients ?? []).filter((c) => {
      return (
        c.name.toLowerCase().includes(term) ||
        (c.email ?? '').toLowerCase().includes(term) ||
        (c.contact ?? '').toLowerCase().includes(term)
      );
    });
  }, [clients, debouncedSearch]);

  return (
    <div>
      <div className="clients-toolbar">
        <div className="search-input">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn primary" onClick={() => setShowCreateModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" />
          Nuevo cliente
        </button>
      </div>

      {isError && (
        <div className="error-banner">
          <span>No pudimos cargar los clientes.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="empty-state">
          <i className="ti ti-users" aria-hidden="true" />
          <p>
            {debouncedSearch
              ? 'No hay clientes que coincidan con tu búsqueda.'
              : 'Todavía no tenés clientes. Creá el primero.'}
          </p>
        </div>
      )}

      <div className="client-grid">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="client-card skeleton-row" />)}
        {filtered.map((client) => (
          <button
            key={client.id}
            className="client-card"
            onClick={() => router.push(`/clients/${client.id}`)}
          >
            <div className="avatar">{initials(client.name)}</div>
            <div className="client-card-name">{client.name}</div>
            <div className="client-card-meta">
              {client.email ?? client.contact ?? 'Sin contacto'}
            </div>
          </button>
        ))}
      </div>

      {showCreateModal && (
        <CreateClientModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(client) => {
            setShowCreateModal(false);
            router.push(`/clients/${client.id}`);
          }}
        />
      )}
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
