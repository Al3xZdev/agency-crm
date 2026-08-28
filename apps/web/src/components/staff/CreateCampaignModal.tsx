'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { Client } from '../../lib/types';

/**
 * Backend-adapted: campaigns nest under clients, so the create call is
 * POST `/api/clients/:clientId/campaigns` with `{ name }` — the client id
 * lives in the path, not the body. Response is `{ id }`, not a full
 * Campaign list item.
 */
export function CreateCampaignModal({
  onClose,
  onCreated,
  defaultClientId,
}: {
  onClose: () => void;
  onCreated: (campaign: { id: string; name: string }) => void;
  defaultClientId?: string;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ['clients', ''],
    queryFn: () => apiFetch<Client[]>('/api/clients'),
    enabled: !defaultClientId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(`/api/clients/${clientId}/campaigns`, {
        method: 'POST',
        body: { name: name.trim() },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onCreated({ id: created.id, name: name.trim() });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear la campaña.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientId) {
      setError('Elegí a qué cliente pertenece esta campaña.');
      return;
    }
    if (!name.trim()) {
      setError('Ingresá un nombre para la campaña.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nueva campaña</h3>
        <form onSubmit={handleSubmit}>
          {!defaultClientId && (
            <div className="field">
              <label htmlFor="campaign-client">Cliente</label>
              <select
                id="campaign-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={loadingClients}
              >
                <option value="">Seleccioná un cliente…</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="campaign-name">Nombre de la campaña</label>
            <input
              id="campaign-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lanzamiento Torre Alameda"
            />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creando…' : 'Crear campaña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}