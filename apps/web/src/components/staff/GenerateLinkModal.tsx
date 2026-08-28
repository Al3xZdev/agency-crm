'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { Client, MagicLink } from '../../lib/types';

/**
 * Backend-adapted: POST /api/clients/:clientId/magic-links returns the
 * ABSOLUTE `url` (`{ id, url, expiresAt }`) — the raw token is never
 * returned, so the link is copied straight from the response instead of
 * composing `${publicUrl}/c/${token}`.
 */
export function GenerateLinkModal({ onClose }: { onClose: () => void }) {
  const [clientId, setClientId] = useState('');
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ['clients', ''],
    queryFn: () => apiFetch<Client[]>('/api/clients'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<MagicLink>(`/api/clients/${clientId}/magic-links`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['magic-links'] });
    },
  });

  const fullLink = mutation.data?.url ?? null;

  async function handleCopy() {
    if (!fullLink) return;
    await navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Generar link mágico</h3>

        {!mutation.data && (
          <>
            <div className="field">
              <label htmlFor="link-client">Cliente</label>
              <select
                id="link-client"
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

            {mutation.isError && (
              <div className="error-banner">
                <span>
                  {mutation.error instanceof ApiError ? mutation.error.message : 'No pudimos generar el link.'}
                </span>
              </div>
            )}

            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={!clientId || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Generando…' : 'Generar link'}
            </button>
          </>
        )}

        {fullLink && (
          <div className="magic-link-result">
            <div className="magic-link-value">{fullLink}</div>
            <button className="btn" onClick={handleCopy}>
              <i className={copied ? 'ti ti-check' : 'ti ti-copy'} aria-hidden="true" />
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}