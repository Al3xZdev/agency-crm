'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { Comment, CommentAnchor } from '../../lib/types';
import { ConfirmModal } from './ConfirmModal';

const ANCHOR_OPTIONS: { value: CommentAnchor; label: string; icon: string }[] = [
  { value: 'PLAIN', label: 'General', icon: 'ti ti-message' },
  { value: 'RANGE', label: 'Rango', icon: 'ti ti-scissors' },
];

/**
 * Backend-adapted comment thread: GET/POST `/api/versions/:versionId/comments`.
 * The API has no `resolved` field and no resolve endpoint (no PATCH), so the
 * reference's "ver resueltos" filter and toggles are dropped. Anchors follow
 * the backend enum: PLAIN, RANGE (startMs/endMs milliseconds). PIN comments
 * are placed via click-to-place on the stage (see CreativeDetailView), not
 * from this panel.
 */
export function CommentThread({
  versionId,
  comments,
  onSeekDraw,
}: {
  versionId: string;
  comments?: Comment[];
  /** Optional: when provided, DRAW comments become clickable to seek the staff
   * video to their frame (mirrors the client lightbox seek-to-drawing). */
  onSeekDraw?: (comment: Comment) => void;
}) {
  const [anchor, setAnchor] = useState<CommentAnchor>('PLAIN');
  const [body, setBody] = useState('');
  const [startMs, setStartMs] = useState('');
  const [endMs, setEndMs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteComment, setConfirmingDeleteComment] = useState<Comment | null>(null);
  const queryClient = useQueryClient();

  // When the parent already loaded the comments (e.g. CreativeDetailView, so it
  // can draw pins), use that array — skip our own query to avoid a duplicate
  // refetch. Otherwise load here so this stays a valid standalone component.
  const { data: fetchedComments, isLoading } = useQuery({
    queryKey: ['comments', versionId],
    queryFn: () => apiFetch<Comment[]>(`/api/versions/${versionId}/comments`),
    enabled: !!versionId && comments === undefined,
  });

  const displayComments = comments ?? fetchedComments;
  // Same filtered order the stage uses to number the pins (`i + 1`).
  const pinComments = (displayComments ?? []).filter((c) => c.anchor === 'PIN');

  const addComment = useMutation({
    mutationFn: () => {
      const payload: {
        anchor: CommentAnchor;
        body: string;
        startMs?: number;
        endMs?: number;
      } = { anchor, body: body.trim() };
      if (anchor === 'RANGE') {
        // UI works in seconds; the API stores milliseconds.
        payload.startMs = Math.round(Number(startMs) * 1000);
        if (endMs !== '' && !Number.isNaN(Number(endMs))) payload.endMs = Math.round(Number(endMs) * 1000);
      }
      return apiFetch<Comment>(`/api/versions/${versionId}/comments`, { method: 'POST', body: payload });
    },
    onSuccess: () => {
      setError(null);
      setBody('');
      setAnchor('PLAIN');
      setStartMs('');
      setEndMs('');
      queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos publicar el comentario.');
    },
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<{ ok: true }>(`/api/versions/${versionId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos eliminar el comentario.');
    },
  });

  function handleDeleteComment(comment: Comment) {
    setConfirmingDeleteComment(comment);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    if (anchor === 'RANGE' && (startMs === '' || Number.isNaN(Number(startMs)))) {
      setError('Ingresá el tiempo "desde" del rango en segundos.');
      return;
    }
    addComment.mutate();
  }

  return (
    <div className="comment-panel">
      <div className="comment-panel-header">
        <span className="eyebrow">Comentarios{displayComments ? ` · ${displayComments.length}` : ''}</span>
      </div>

      <div className="comment-list">
        {isLoading && (
          <div className="mono" style={{ color: 'var(--text-dim)' }}>
            Cargando…
          </div>
        )}
        {!isLoading && (displayComments?.length ?? 0) === 0 && (
          <p className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Sin comentarios todavía.
          </p>
        )}
        {displayComments?.map((comment) => {
          const pinNumber =
            comment.anchor === 'PIN' ? pinComments.indexOf(comment) + 1 : undefined;
          const seekable = comment.anchor === 'DRAW' && !!onSeekDraw;
          return (
            <div
              key={comment.id}
              className={`comment${seekable ? ' seekable' : ''}`}
              onClick={seekable ? () => onSeekDraw!(comment) : undefined}
              role={seekable ? 'button' : undefined}
              title={seekable ? 'Ver este dibujo sobre el video' : undefined}
            >
              <div>
                <span className={`who is-${comment.authorType.toLowerCase()}`}>{comment.authorLabel}</span>
                <span className={`role-tag ${comment.authorType.toLowerCase()}`}>
                  {comment.authorType === 'STAFF' ? 'Agencia' : 'Cliente'}
                </span>
                <span className="when">{formatAnchor(comment, pinNumber)}</span>
                <button
                  type="button"
                  title="Eliminar comentario"
                  className="comment-delete"
                  disabled={deleteComment.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteComment(comment);
                  }}
                >
                  <i className="ti ti-trash" aria-hidden="true" />
                </button>
              </div>
              <div className="txt">{comment.body}</div>
            </div>
          );
        })}
      </div>

      <form className="comment-form" onSubmit={handleSubmit} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="type-toggle">
          {ANCHOR_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${anchor === option.value ? 'active' : ''}`}
              onClick={() => setAnchor(option.value)}
            >
              <i className={option.icon} style={{ marginRight: 4 }} />
              {option.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Agregar comentario interno…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button type="submit" className="btn ghost" disabled={addComment.isPending || !body.trim()}>
            <i className="ti ti-send" aria-hidden="true" />
          </button>
        </div>
        {anchor === 'RANGE' && (
          <div className="anchor-fields">
            <label className="anchor-field">
              <span>Desde (segundos)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                placeholder="ej: 3"
                value={startMs}
                onChange={(e) => setStartMs(e.target.value)}
              />
            </label>
            <label className="anchor-field">
              <span>Hasta (segundos)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                placeholder="ej: 12"
                value={endMs}
                onChange={(e) => setEndMs(e.target.value)}
              />
            </label>
            <p className="anchor-help">Tramo del video en segundos (ej: desde 3 hasta 12).</p>
          </div>
        )}
        {error && <p className="field-error" style={{ margin: 0 }}>{error}</p>}
      </form>

      {confirmingDeleteComment && (
        <ConfirmModal
          open
          title="Eliminar comentario"
          message="¿Eliminar este comentario? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          confirmIcon="ti ti-trash"
          busy={deleteComment.isPending}
          onConfirm={() => {
            if (confirmingDeleteComment) deleteComment.mutate(confirmingDeleteComment.id);
            setConfirmingDeleteComment(null);
          }}
          onCancel={() => setConfirmingDeleteComment(null)}
        />
      )}
    </div>
  );
}

/** Backend anchors carry basis-point coordinates (0–10000). For staff, a PIN
 * comment is shown as its numbered reference `#N` (matching the numbered pin
 * over the stage) — the raw coordinate text is no longer the primary display.
 * Falls back to the coordinate text only when no pin index is available.
 * Range times are shown in seconds. */
function formatAnchor(comment: Comment, pinNumber?: number): string {
  if (comment.anchor === 'PIN') {
    if (pinNumber != null) return `pin #${pinNumber}`;
    if (comment.posX == null) return 'pin';
    const x = Math.round((comment.posX / 100) * 10) / 10;
    const y = Math.round(((comment.posY ?? 0) / 100) * 10) / 10;
    return `pin · x${x}% y${y}%`;
  }
  if (comment.anchor === 'RANGE') {
    if (comment.startMs == null) return 'rango';
    const desde = `${(comment.startMs / 1000).toFixed(1)}s`;
    if (comment.endMs != null) {
      return `rango · desde ${desde} hasta ${(comment.endMs / 1000).toFixed(1)}s`;
    }
    return `rango · desde ${desde}`;
  }
  return 'general';
}