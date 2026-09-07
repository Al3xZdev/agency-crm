'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { apiJson } from '../../../../lib/api';
import { formatMs } from '../../../../lib/format';
import { ConfirmModal } from '../../../../components/staff/ConfirmModal';
import { DrawingOverlay } from '../../../../components/client/DrawingOverlay';
import type { Stroke } from '../../../../lib/types';

interface VersionDetail {
  id: string;
  creativeId: string;
  versionNo: number;
  state: string;
  reviewStatus: string;
  textBody: string | null;
  failReason: string | null;
  durationMs: number | null;
  createdAt: string;
  asset: { sha256: string; mime: string; byteSize: number; storageKey: string } | null;
  poster: { sha256: string; mime: string; byteSize: number; storageKey: string } | null;
  posterUrl: string | null;
  commentsCount: number;
  reviewEvent: { id: string; decision: string; actorType: string; actorLabel: string; occurredAt: string } | null;
}

interface CommentRow {
  id: string;
  anchor: string;
  posX: number | null;
  posY: number | null;
  startMs: number | null;
  endMs: number | null;
  strokes: Stroke[] | null;
  body: string;
  authorType: string;
  authorLabel: string;
  createdAt: string;
  editedAt: string | null;
  canDelete: boolean;
  canEdit: boolean;
}

const ANCHOR_TYPES = ['PLAIN', 'PIN', 'RANGE'] as const;

/** Media-time badge for anchored comments (mirrors CommentThread): PIN shows
 * `#N · mm:ss`, RANGE/DRAW show their mm:ss window as a mono pill. PLAIN
 * comments render nothing. */
function AnchorBadge(c: CommentRow, pinNumber?: number): ReactNode {
  if (c.anchor === 'PIN' && pinNumber != null) {
    return (
      <span className="time-badge">
        <i className="ti ti-pin" aria-hidden="true" />
        #{pinNumber}
        {c.startMs != null ? ` · ${formatMs(c.startMs)}` : ''}
      </span>
    );
  }
  if (c.anchor === 'RANGE' && c.startMs != null) {
    const end = c.endMs != null ? ` – ${formatMs(c.endMs)}` : '';
    return (
      <span className="time-badge">
        <i className="ti ti-timeline" aria-hidden="true" />
        {formatMs(c.startMs)}
        {end}
      </span>
    );
  }
  if (c.anchor === 'DRAW' && c.startMs != null) {
    return (
      <span className="time-badge">
        <i className="ti ti-brush" aria-hidden="true" />
        {formatMs(c.startMs)}
      </span>
    );
  }
  return null;
}

export default function VersionReviewPage() {
  const params = useParams<{ id: string }>();
  const versionId = params.id;
  const queryClient = useQueryClient();
  const router = useRouter();

  const [anchor, setAnchor] = useState<(typeof ANCHOR_TYPES)[number]>('PLAIN');
  const [posX, setPosX] = useState('');
  const [posY, setPosY] = useState('');
  const [startMs, setStartMs] = useState('');
  const [endMs, setEndMs] = useState('');
  const [body, setBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDeleteVersion, setConfirmingDeleteVersion] = useState(false);
  const [confirmingDeleteCommentId, setConfirmingDeleteCommentId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  // VIDEO playback state drives DRAW overlays so strokes align with the
  // frozen frame (mirrors CreativeDetailView/LightboxView).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [paused, setPaused] = useState(true);

  const version = useQuery({
    queryKey: ['version', versionId],
    queryFn: () => apiJson<VersionDetail>(`/api/versions/${versionId}`),
  });

  const comments = useQuery({
    queryKey: ['comments', versionId],
    queryFn: () => apiJson<CommentRow[]>(`/api/versions/${versionId}/comments`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: {
      anchor: string;
      body: string;
      posX?: number;
      posY?: number;
      startMs?: number;
      endMs?: number;
    }) =>
      apiJson<CommentRow>(`/api/versions/${versionId}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setCommentError(null);
      setBody('');
      setAnchor('PLAIN');
      setPosX('');
      setPosY('');
      setStartMs('');
      setEndMs('');
      void queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
      void queryClient.invalidateQueries({ queryKey: ['version', versionId] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) =>
      apiJson<{ ok: true }>(`/api/versions/${versionId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
      void queryClient.invalidateQueries({ queryKey: ['version', versionId] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  const editComment = useMutation({
    mutationFn: ({ commentId, body: nextBody }: { commentId: string; body: string }) =>
      apiJson<CommentRow>(`/api/versions/${versionId}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: nextBody }),
      }),
    onSuccess: () => {
      setCommentError(null);
      setEditingCommentId(null);
      setEditBody('');
      void queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  function onDeleteComment(commentId: string) {
    setConfirmingDeleteCommentId(commentId);
  }

  function onConfirmDeleteComment() {
    if (!confirmingDeleteCommentId) return;
    deleteComment.mutate(confirmingDeleteCommentId);
    setConfirmingDeleteCommentId(null);
  }

  function onDeleteVersion() {
    if (!version.data) return;
    setConfirmingDeleteVersion(true);
  }

  async function onConfirmDeleteVersion() {
    if (!version.data) return;
    setConfirmingDeleteVersion(false);
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiJson<{ ok: true }>(`/api/versions/${version.data.id}`, { method: 'DELETE' });
      router.push(`/creatives/${version.data.creativeId}`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No pudimos eliminar la versión.');
    } finally {
      setDeleting(false);
    }
  }

  function onComment(e: FormEvent) {
    e.preventDefault();
    setCommentError(null);
    const payload: {
      anchor: string;
      body: string;
      posX?: number;
      posY?: number;
      startMs?: number;
      endMs?: number;
    } = { anchor, body: body.trim() };

    if (anchor === 'PIN') {
      const x = Number(posX);
      const y = Number(posY);
      if (posX === '' || posY === '' || Number.isNaN(x) || Number.isNaN(y) || x < 0 || x > 100 || y < 0 || y > 100) {
        setCommentError('Ingresá las coordenadas X e Y del pin en porcentaje (0–100).');
        return;
      }
      // UI works in %; the API stores basis points (0–10000).
      payload.posX = Math.round(x * 100);
      payload.posY = Math.round(y * 100);
    }
    if (anchor === 'RANGE') {
      if (startMs === '' || Number.isNaN(Number(startMs))) {
        setCommentError('Ingresá el tiempo "desde" del rango en segundos.');
        return;
      }
      // UI works in seconds; the API stores milliseconds.
      payload.startMs = Math.round(Number(startMs) * 1000);
      if (endMs !== '' && !Number.isNaN(Number(endMs))) payload.endMs = Math.round(Number(endMs) * 1000);
    }

    if (!payload.body.trim()) {
      setCommentError('Escribí un comentario antes de publicar.');
      return;
    }

    addComment.mutate(payload);
  }

  if (version.isLoading) return <p>Cargando…</p>;
  if (version.isError) {
    return (
      <p role="alert">
        Versión no encontrada. <Link href="/clients">Volver a clientes</Link>
      </p>
    );
  }

  const v = version.data!;

  const pinComments = (comments.data ?? []).filter((c) => c.anchor === 'PIN');

  /** Numbered pin overlay for PIN comments (same numbering as the list: i+1). */
  function renderPins(): ReactNode {
    if (pinComments.length === 0) return null;
    return pinComments.map((c, i) => (
      <div
        key={c.id}
        className="pin"
        // posX/posY are 0..10000 basis points; /100 = percentage.
        style={{ top: `${(c.posY ?? 0) / 100}%`, left: `${(c.posX ?? 0) / 100}%` }}
        title={`#${i + 1} · ${formatMs(c.startMs ?? 0)}`}
      >
        {i + 1}
        <span className="pin-time">{formatMs(c.startMs ?? 0)}</span>
      </div>
    ));
  }

  /** Read-mode DRAW overlays (mirrors CreativeDetailView): for VIDEO the strokes
   * only render while paused on the matching frame; for IMAGE they always do. */
  function renderDraws(forImage: boolean): ReactNode {
    const draws = (comments.data ?? []).filter((c) => c.anchor === 'DRAW' && (c.strokes?.length ?? 0) > 0);
    if (draws.length === 0) return null;
    return draws.map((c) => {
      const show = forImage || (paused && Math.abs(currentTimeMs - (c.startMs ?? 0)) < 150);
      if (!show) return null;
      return (
        <DrawingOverlay key={c.id} active={false} containerRef={stageRef} strokes={c.strokes ?? []} paused />
      );
    });
  }

  return (
    <>
      <h1>Versión {v.versionNo}</h1>
      <p style={{ color: '#666' }}>
        Estado: <strong>{v.state}</strong> · Revisión: <strong>{v.reviewStatus}</strong> ·{' '}
        {new Date(v.createdAt).toLocaleDateString()}
        <button
          onClick={onDeleteVersion}
          disabled={deleting}
          style={{
            marginLeft: 12,
            padding: '4px 10px',
            background: '#b00020',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          <i className="ti ti-trash" aria-hidden="true" /> Eliminar versión
        </button>
      </p>
      {deleteError && (
        <p role="alert" style={{ color: '#b00020' }}>
          {deleteError}
        </p>
      )}

      <section style={{ margin: '16px 0' }}>
        <h2>Vista previa</h2>
        {v.state !== 'READY' && v.state !== 'FAILED' && (
          <p style={{ color: '#666' }}>Procesando{v.failReason ? `: ${v.failReason}` : '…'}</p>
        )}
        {v.state === 'READY' && v.asset && v.asset.mime.startsWith('image') && (
          <div ref={stageRef} className="media-stage">
            <img
              src={`/media/${v.posterUrl ?? v.asset.storageKey}`}
              alt={`Versión ${v.versionNo}`}
              style={{ maxWidth: '100%', maxHeight: 500, display: 'block', margin: '0 auto' }}
            />
            {renderDraws(true)}
            {renderPins()}
          </div>
        )}
        {v.state === 'READY' && v.asset && v.asset.mime.startsWith('video') && (
          <div ref={stageRef} className="media-stage">
            <video
              ref={videoRef}
              src={`/media/${v.asset.storageKey}`}
              poster={v.posterUrl ? `/media/${v.posterUrl}` : undefined}
              controls
              style={{ maxWidth: '100%', maxHeight: 500, display: 'block', margin: '0 auto' }}
              onTimeUpdate={(e) => setCurrentTimeMs(Math.round(e.currentTarget.currentTime * 1000))}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
            />
            {renderDraws(false)}
            {renderPins()}
          </div>
        )}
        {v.state === 'READY' && v.textBody && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              padding: 12,
              background: '#f9f9f9',
              border: '1px solid #eee',
              borderRadius: 4,
            }}
          >
            {v.textBody}
          </pre>
        )}
      </section>

      <section style={{ margin: '16px 0' }}>
        <h2>Comentarios ({v.commentsCount})</h2>
        {(comments.data ?? []).length === 0 && <p>Todavía no hay comentarios.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(comments.data ?? []).map((c) => {
            const pinNumber = c.anchor === 'PIN' ? pinComments.indexOf(c) + 1 : undefined;
            const isEditing = editingCommentId === c.id;
            return (
              <li
                key={c.id}
                style={{ padding: '8px 0', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', gap: 8 }}
              >
                <div style={{ flex: 1 }}>
                  <strong>{c.authorLabel}</strong> ({c.authorType})
                  {AnchorBadge(c, pinNumber)}
                  {c.editedAt ? <span className="edited-mark">· editado</span> : null}
                  <span className="created-meta">{new Date(c.createdAt).toLocaleString()}</span>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      <textarea
                        rows={2}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        placeholder="Editá el comentario…"
                        style={{ padding: 8 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditBody('');
                          }}
                          style={{ padding: '4px 10px' }}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={!editBody.trim() || editComment.isPending}
                          onClick={() => editComment.mutate({ commentId: c.id, body: editBody.trim() })}
                          style={{ padding: '4px 10px' }}
                        >
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: '4px 0 0' }}>{c.body}</p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  {c.canEdit && !isEditing ? (
                    <button
                      title="Editar comentario"
                      onClick={() => {
                        setEditingCommentId(c.id);
                        setEditBody(c.body);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 4 }}
                    >
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                  ) : null}
                  {c.canDelete ? (
                    <button
                      title="Eliminar comentario"
                      onClick={() => onDeleteComment(c.id)}
                      disabled={deleteComment.isPending}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 4 }}
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <form onSubmit={onComment} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 500, marginTop: 12 }}>
          <textarea
            rows={3}
            required
            placeholder="Agregar un comentario…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ padding: 8 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#666' }}>Tipo de ancla</span>
              <select value={anchor} onChange={(e) => setAnchor(e.target.value as (typeof ANCHOR_TYPES)[number])} style={{ padding: 8 }}>
                {ANCHOR_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            {anchor === 'PIN' && (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>X (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="0–100"
                    value={posX}
                    onChange={(e) => setPosX(e.target.value)}
                    style={{ padding: 8, width: 110 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>Y (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="0–100"
                    value={posY}
                    onChange={(e) => setPosY(e.target.value)}
                    style={{ padding: 8, width: 110 }}
                  />
                </label>
                <p style={{ width: '100%', margin: 0, fontSize: 12, color: '#666' }}>
                  Marcá la posición sobre el video en porcentaje (0–100).
                </p>
              </>
            )}
            {anchor === 'RANGE' && (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>Desde (segundos)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="ej: 3"
                    value={startMs}
                    onChange={(e) => setStartMs(e.target.value)}
                    style={{ padding: 8, width: 110 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>Hasta (segundos)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="ej: 12"
                    value={endMs}
                    onChange={(e) => setEndMs(e.target.value)}
                    style={{ padding: 8, width: 110 }}
                  />
                </label>
                <p style={{ width: '100%', margin: 0, fontSize: 12, color: '#666' }}>
                  Tramo del video en segundos (ej: desde 3 hasta 12).
                </p>
              </>
            )}
          </div>
          {commentError && (
            <p role="alert" style={{ color: '#b00020' }}>
              {commentError}
            </p>
          )}
          <button type="submit" disabled={addComment.isPending} style={{ padding: '8px 16px', alignSelf: 'flex-start' }}>
            Publicar comentario
          </button>
        </form>
      </section>

      <p style={{ marginTop: 16 }}>
        <Link href={`/creatives/${v.creativeId}`}>Volver al creativo</Link>
      </p>

      <ConfirmModal
        open={confirmingDeleteVersion}
        title="Eliminar versión"
        message="¿Eliminar esta versión con sus comentarios? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        confirmIcon="ti ti-trash"
        busy={deleting}
        onConfirm={() => void onConfirmDeleteVersion()}
        onCancel={() => setConfirmingDeleteVersion(false)}
      />

      <ConfirmModal
        open={!!confirmingDeleteCommentId}
        title="Eliminar comentario"
        message="¿Eliminar este comentario? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        confirmIcon="ti ti-trash"
        busy={deleteComment.isPending}
        onConfirm={onConfirmDeleteComment}
        onCancel={() => setConfirmingDeleteCommentId(null)}
      />
    </>
  );
}
