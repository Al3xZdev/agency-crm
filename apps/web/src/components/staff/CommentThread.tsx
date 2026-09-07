'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { formatMs } from '../../lib/format';
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
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
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

  const editComment = useMutation({
    mutationFn: ({ commentId, nextBody }: { commentId: string; nextBody: string }) =>
      apiFetch<Comment>(`/api/versions/${versionId}/comments/${commentId}`, {
        method: 'PATCH',
        body: { body: nextBody },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
      setEditingCommentId(null);
      setEditBody('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos editar el comentario.');
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
          const isEditing = editingCommentId === comment.id;
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
                {formatAnchor(comment, pinNumber)}
                {comment.editedAt && <span className="edited-mark">· editado</span>}
                {comment.canEdit && !isEditing && (
                  <button
                    type="button"
                    title="Editar comentario"
                    className="comment-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCommentId(comment.id);
                      setEditBody(comment.body);
                    }}
                  >
                    <i className="ti ti-pencil" aria-hidden="true" />
                  </button>
                )}
                {comment.canDelete && !isEditing && (
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
                )}
              </div>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <textarea
                    rows={2}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="Editá el comentario…"
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setEditingCommentId(null);
                        setEditBody('');
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!editBody.trim() || editComment.isPending}
                      onClick={() => editComment.mutate({ commentId: comment.id, nextBody: editBody.trim() })}
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="txt">{comment.body}</div>
              )}
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

/** Media-time badge for anchored comments. PIN shows its numbered reference
 * `#N` (matching the numbered pin over the stage) plus the media time when the
 * client captured one; RANGE and DRAW show their media times as mm:ss. PLAIN
 * comments render no badge. Returns null when there is no time to show. */
function formatAnchor(comment: Comment, pinNumber?: number): ReactNode {
  if (comment.anchor === 'PIN') {
    if (pinNumber == null) return null;
    return (
      <span className="when" title={comment.body}>
        <i className="ti ti-pin" aria-hidden="true" />
        #{pinNumber}
        {comment.startMs != null ? ` · ${formatMs(comment.startMs)}` : ''}
      </span>
    );
  }
  if (comment.anchor === 'RANGE' && comment.startMs != null) {
    const end = comment.endMs != null ? ` – ${formatMs(comment.endMs)}` : '';
    return (
      <span className="when">
        <i className="ti ti-timeline" aria-hidden="true" />
        {formatMs(comment.startMs)}
        {end}
      </span>
    );
  }
  if (comment.anchor === 'DRAW' && comment.startMs != null) {
    return (
      <span className="when">
        <i className="ti ti-brush" aria-hidden="true" />
        {formatMs(comment.startMs)}
      </span>
    );
  }
  return null;
}