'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { CreativeKind, CreativeStatus } from '../../lib/types';

const TYPE_OPTIONS: { value: CreativeKind; label: string; icon: string }[] = [
  { value: 'IMAGE', label: 'Imagen', icon: 'photo' },
  { value: 'VIDEO', label: 'Video', icon: 'video' },
  { value: 'TEXT', label: 'Texto', icon: 'align-left' },
];

/**
 * Backend-adapted: POST /api/campaigns/:campaignId/creatives takes
 * `{ title, kind }` (the reference's `name`/`type` do not exist in the API)
 * and returns the created row `{ id, kind, status }`.
 */
export function CreateCreativeModal({
  campaignId,
  onClose,
  onCreated,
}: {
  campaignId: string;
  onClose: () => void;
  onCreated: (creative: { id: string; title: string; kind: CreativeKind }) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<CreativeKind>('IMAGE');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; kind: CreativeKind; status: CreativeStatus }>(
        `/api/campaigns/${campaignId}/creatives`,
        { method: 'POST', body: { title: title.trim(), kind } },
      ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      onCreated({ id: created.id, title: title.trim(), kind: created.kind });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear el creativo.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Ingresá un nombre para el creativo.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo creativo</h3>
        <p className="modal-subtitle">Después de crearlo vas a poder subir su primera versión.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="creative-name">Nombre</label>
            <input
              id="creative-name"
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reel — Torre Alameda"
            />
          </div>
          <div className="field">
            <label>Tipo</label>
            <div className="type-toggle">
              {TYPE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={kind === option.value ? 'chip active' : 'chip'}
                  onClick={() => setKind(option.value)}
                >
                  <i className={`ti ti-${option.icon}`} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creando…' : 'Crear y subir versión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}