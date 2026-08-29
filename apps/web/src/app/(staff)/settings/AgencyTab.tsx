'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../../lib/api';
import { Agency } from '../../../lib/types';

/** GET/PATCH /api/agency — edit the agency name with save hint + inline error. */
export function AgencyTab() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const { data: agency, isLoading } = useQuery({
    queryKey: ['agency'],
    queryFn: () => apiFetch<Agency>('/api/agency'),
  });

  useEffect(() => {
    if (agency) setName(agency.name);
  }, [agency]);

  const mutation = useMutation({
    mutationFn: () => apiFetch<Agency>('/api/agency', { method: 'PATCH', body: { name: name.trim() } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['agency'], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos guardar los cambios.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('El nombre de la agencia no puede estar vacío.');
      return;
    }
    mutation.mutate();
  }

  if (isLoading) return <div className="settings-card skeleton-row" style={{ height: 140 }} />;

  return (
    <div className="settings-card">
      <h3>Datos de la agencia</h3>
      <p className="modal-subtitle">Este nombre aparece en el portal que ven tus clientes.</p>
      <form onSubmit={handleSubmit} className="settings-form">
        <div className="field">
          <label htmlFor="agency-name">Nombre de la agencia</label>
          <input id="agency-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="settings-form-actions">
          {saved && (
            <span className="saved-hint">
              <i className="ti ti-check" aria-hidden="true" /> Guardado
            </span>
          )}
          <button type="submit" className="btn primary" disabled={mutation.isPending || name.trim() === agency?.name}>
            {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
