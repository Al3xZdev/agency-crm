'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { MagicLinkListItem } from '../../lib/types';

type LinkStatus = 'ACTIVE_UNUSED' | 'ACTIVE_USED' | 'EXPIRED' | 'REVOKED';

const STATUS_LABEL: Record<LinkStatus, { label: string; className: string }> = {
  ACTIVE_UNUSED: { label: 'activo · sin usar', className: 'pill pending' },
  ACTIVE_USED: { label: 'activo · usado', className: 'pill approved' },
  EXPIRED: { label: 'expirado', className: 'pill processing' },
  REVOKED: { label: 'revocado', className: 'pill rejected' },
};

function getStatus(link: MagicLinkListItem): LinkStatus {
  if (link.revokedAt) return 'REVOKED';
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return 'EXPIRED';
  if (link.lastUsedAt) return 'ACTIVE_USED';
  return 'ACTIVE_UNUSED';
}

/**
 * Magic link row — display + revoke, backend-adapted.
 *
 * The backend stores only a token HASH and returns the absolute URL at mint
 * time; `GET /api/magic-links` never carries a usable token. The list
 * therefore has NO copy button (unlike the reference, which copied
 * `/c/${token}`) — that affordance lives in GenerateLinkModal, right where
 * the URL is minted. Revoking is POST /api/magic-links/:id/revoke and
 * invalidates the active sessions for that link.
 */
export function MagicLink({ link }: { link: MagicLinkListItem }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => apiFetch<{ revokedSessions: number }>(`/api/magic-links/${link.id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['magic-links'] });
      setConfirming(false);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos revocar el link.');
    },
  });

  const status = getStatus(link);
  const statusInfo = STATUS_LABEL[status];

  return (
    <div className="list-row link-row">
      <div>{link.clientName}</div>
      <div className="mono muted">{formatDate(link.createdAt)}</div>
      <div className="mono muted">{link.lastUsedAt ? formatDate(link.lastUsedAt) : '—'}</div>
      <div>
        <span className={statusInfo.className}>{statusInfo.label}</span>
      </div>
      <div className="link-actions">
        {status !== 'REVOKED' && (
          <>
            {confirming ? (
              <span className="confirm-inline">
                <button className="btn red" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                  Confirmar
                </button>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                className="btn ghost icon-btn"
                title="Revocar link"
                onClick={() => setConfirming(true)}
              >
                <i className="ti ti-ban" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
      {error && <div className="field-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
    </div>
  );
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}