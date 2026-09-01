'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../../lib/api';
import { ConfirmModal } from '../../../../components/staff/ConfirmModal';

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
  body: string;
  authorType: string;
  authorLabel: string;
  createdAt: string;
}

const ANCHOR_TYPES = ['PLAIN', 'PIN', 'RANGE'] as const;

/** Backend anchors carry basis points (0–10000) and milliseconds — render
 * human units: percentages (1 decimal) and seconds. */
function DescribeAnchor(c: CommentRow): string {
  if (c.anchor === 'PIN' && c.posX != null && c.posY != null) {
    const x = Math.round((c.posX / 100) * 10) / 10;
    const y = Math.round((c.posY / 100) * 10) / 10;
    return ` @ (${x}%, ${y}%)`;
  }
  if (c.anchor === 'RANGE' && c.startMs != null) {
    const desde = `${(c.startMs / 1000).toFixed(1)}s`;
    if (c.endMs != null) return ` [${desde} – ${(c.endMs / 1000).toFixed(1)}s]`;
    return ` [${desde} –]`;
  }
  return '';
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
          <img
            src={`/media/${v.posterUrl ?? v.asset.storageKey}`}
            alt={`Versión ${v.versionNo}`}
            style={{ maxWidth: '100%', maxHeight: 500 }}
          />
        )}
        {v.state === 'READY' && v.asset && v.asset.mime.startsWith('video') && (
          <video
            src={`/media/${v.asset.storageKey}`}
            poster={v.posterUrl ? `/media/${v.posterUrl}` : undefined}
            controls
            style={{ maxWidth: '100%', maxHeight: 500 }}
          />
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
          {(comments.data ?? []).map((c) => (
            <li
              key={c.id}
              style={{ padding: '8px 0', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', gap: 8 }}
            >
              <div>
                <strong>{c.authorLabel}</strong> ({c.authorType})
                {c.anchor === 'DRAW' && (
                  <span title="Drawing comment" style={{ marginLeft: 6 }}>
                    <i className="ti ti-brush" aria-hidden="true" />
                  </span>
                )}
                {DescribeAnchor(c)}
                <span style={{ color: '#999', marginLeft: 8 }}>
                  {new Date(c.createdAt).toLocaleString()}
                </span>
                <p style={{ margin: '4px 0 0' }}>{c.body}</p>
              </div>
              <button
                title="Eliminar comentario"
                onClick={() => onDeleteComment(c.id)}
                disabled={deleteComment.isPending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 4, alignSelf: 'flex-start', flexShrink: 0 }}
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </li>
          ))}
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
