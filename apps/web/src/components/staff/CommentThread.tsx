'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { Comment, CommentAnchor } from '../../lib/types';

const ANCHOR_OPTIONS: { value: CommentAnchor; label: string; icon: string }[] = [
  { value: 'PLAIN', label: 'General', icon: 'ti ti-message' },
  { value: 'PIN', label: 'Pin', icon: 'ti ti-pin' },
  { value: 'RANGE', label: 'Rango', icon: 'ti ti-scissors' },
];

/**
 * Backend-adapted comment thread: GET/POST `/api/versions/:versionId/comments`.
 * The API has no `resolved` field and no resolve endpoint (no PATCH), so the
 * reference's "ver resueltos" filter and toggles are dropped. Anchors follow
 * the backend enum: PLAIN, PIN (posX/posY basis points 0–10000), RANGE
 * (startMs/endMs milliseconds).
 */
export function CommentThread({ versionId }: { versionId: string }) {
  const [anchor, setAnchor] = useState<CommentAnchor>('PLAIN');
  const [body, setBody] = useState('');
  const [posX, setPosX] = useState('');
  const [posY, setPosY] = useState('');
  const [startMs, setStartMs] = useState('');
  const [endMs, setEndMs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: comments, isLoading } = useQuery({
    queryKey: ['comments', versionId],
    queryFn: () => apiFetch<Comment[]>(`/api/versions/${versionId}/comments`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: () => {
      const payload: {
        anchor: CommentAnchor;
        body: string;
        posX?: number;
        posY?: number;
        startMs?: number;
        endMs?: number;
      } = { anchor, body: body.trim() };
      if (anchor === 'PIN') {
        payload.posX = Number(posX);
        payload.posY = Number(posY);
      }
      if (anchor === 'RANGE') {
        payload.startMs = Number(startMs);
        if (endMs !== '') payload.endMs = Number(endMs);
      }
      return apiFetch<Comment>(`/api/versions/${versionId}/comments`, { method: 'POST', body: payload });
    },
    onSuccess: () => {
      setError(null);
      setBody('');
      setAnchor('PLAIN');
      setPosX('');
      setPosY('');
      setStartMs('');
      setEndMs('');
      queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos publicar el comentario.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    if (anchor === 'PIN' && (Number.isNaN(Number(posX)) || Number.isNaN(Number(posY)))) {
      setError('Ingresá las coordenadas X e Y del pin.');
      return;
    }
    if (anchor === 'RANGE' && (Number.isNaN(Number(startMs)) || startMs === '')) {
      setError('Ingresá el tiempo inicial del rango.');
      return;
    }
    addComment.mutate();
  }

  return (
    <div className="comment-panel">
      <div className="comment-panel-header">
        <span className="eyebrow">Comentarios{comments ? ` · ${comments.length}` : ''}</span>
      </div>

      <div className="comment-list">
        {isLoading && (
          <div className="mono" style={{ color: 'var(--text-dim)' }}>
            Cargando…
          </div>
        )}
        {!isLoading && (comments?.length ?? 0) === 0 && (
          <p className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Sin comentarios todavía.
          </p>
        )}
        {comments?.map((comment) => (
          <div key={comment.id} className="comment">
            <div>
              <span className="who">{comment.authorLabel}</span>
              <span className="when">{formatAnchor(comment)}</span>
            </div>
            <div className="txt">{comment.body}</div>
          </div>
        ))}
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
        {anchor === 'PIN' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" placeholder="X %" value={posX} onChange={(e) => setPosX(e.target.value)} />
            <input type="number" placeholder="Y %" value={posY} onChange={(e) => setPosY(e.target.value)} />
          </div>
        )}
        {anchor === 'RANGE' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" placeholder="desde (ms)" value={startMs} onChange={(e) => setStartMs(e.target.value)} />
            <input type="number" placeholder="hasta (ms)" value={endMs} onChange={(e) => setEndMs(e.target.value)} />
          </div>
        )}
        {error && <p className="field-error" style={{ margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
}

/** Backend anchors carry basis-point coordinates (0–10000) — display %. */
function formatAnchor(comment: Comment): string {
  if (comment.anchor === 'PIN') {
    if (comment.posX == null) return 'pin';
    return `pin · x${Math.round(comment.posX / 100)}% y${Math.round((comment.posY ?? 0) / 100)}%`;
  }
  if (comment.anchor === 'RANGE') {
    if (comment.startMs == null) return 'rango';
    return `rango · desde ${(comment.startMs / 1000).toFixed(1)}s`;
  }
  return 'general';
}