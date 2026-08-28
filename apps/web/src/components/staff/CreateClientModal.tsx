'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';

/**
 * Backend-adapted: POST /api/clients returns `{ id }` (created row), so the
 * callback carries id + the name typed in the form — not a full Client.
 */
export function CreateClientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (client: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/api/clients', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onCreated({ id: created.id, name: name.trim() });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear el cliente.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Ingresá un nombre para el cliente.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo cliente</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="client-name">Nombre del cliente</label>
            <input
              id="client-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Inmobiliaria Sur"
            />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creando…' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}