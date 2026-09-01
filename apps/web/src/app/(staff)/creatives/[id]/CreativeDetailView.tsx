'use client';

import { FormEvent, MouseEvent, RefObject, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Comment,
  Creative,
  CreativeKind,
  CreativeStatus,
  CreativeVersionSummary,
  MagicLink,
  ReviewStatus,
} from '../../../../lib/types';
import { StatusPill } from '../../../../components/staff/StatusPill';
import { CommentThread } from '../../../../components/staff/CommentThread';
import { ConfirmModal } from '../../../../components/staff/ConfirmModal';
import { DrawingOverlay } from '../../../../components/client/DrawingOverlay';

/** Transient pin draft: click position on the media, ready to post. */
interface PinDraft {
  leftPct: number;
  topPct: number;
}

/**
 * Creative detail (PR4). Data:
 *  - GET /api/creatives/:id — creative header (title/kind/status).
 *  - GET /api/creatives/:id/versions — version filmstrip (separate endpoint).
 *  - GET/POST /api/versions/:versionId/comments via CommentThread.
 *  - Client casts a review decision via the /api/c/versions/:versionId/decision endpoint.
 * The creative header has no clientName, so the breadcrumb links back to the
 * owning campaign.
 */
export function CreativeDetailView({ creativeId }: { creativeId: string }) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<MagicLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pinText, setPinText] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmingDeleteCreative, setConfirmingDeleteCreative] = useState(false);
  const [confirmingDeleteVersionId, setConfirmingDeleteVersionId] = useState<string | null>(null);
  // Staff video state: live playback position + pause flag drive the DRAW
  // comment overlays so they align with the frozen frame (mirrors the client
  // LightboxView). Resets when the selected version changes.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [paused, setPaused] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: creative, isLoading, isError, refetch } = useQuery({
    queryKey: ['creative', creativeId],
    queryFn: () => apiFetch<Creative>(`/api/creatives/${creativeId}`),
  });

  const {
    data: versions,
    isLoading: loadingVersions,
    isError: versionsError,
  } = useQuery({
    queryKey: ['versions', creativeId],
    queryFn: () => apiFetch<CreativeVersionSummary[]>(`/api/creatives/${creativeId}/versions`),
    enabled: !!creativeId,
  });

  // Comments for the selected version (same key as CommentThread's own query so
  // the parent and child share ONE array/order). Used to draw pins over the
  // stage AND to number them in the list — both derive from these comments.
  const { data: selectedComments } = useQuery({
    queryKey: ['comments', selectedVersionId],
    queryFn: () => apiFetch<Comment[]>(`/api/versions/${selectedVersionId}/comments`),
    enabled: !!selectedVersionId,
  });

  const mintMagicLink = useMutation({
    mutationFn: () => {
      if (!creative) throw new ApiError('El creativo no está cargado.', 0);
      return apiFetch<MagicLink>(`/api/clients/${creative.clientId}/magic-links`, { method: 'POST', body: {} });
    },
    onSuccess: (link) => {
      setMagicLink(link);
      setLinkCopied(false);
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : 'No pudimos generar el link.');
    },
  });

  const deleteCreative = useMutation({
    mutationFn: () => apiFetch<{ ok: true }>(`/api/creatives/${creativeId}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/creatives'),
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : 'No pudimos eliminar el creativo.');
    },
  });

  const addPinComment = useMutation({
    mutationFn: (payload: { body: string; posX: number; posY: number }) =>
      apiFetch<Comment>(`/api/versions/${selectedVersionId}/comments`, {
        method: 'POST',
        body: { anchor: 'PIN', ...payload },
      }),
    onSuccess: () => {
      setPinDraft(null);
      setPinText('');
      setPinError(null);
      setPinMode(false);
      queryClient.invalidateQueries({ queryKey: ['comments', selectedVersionId] });
    },
    onError: (err) => {
      setPinError(err instanceof ApiError ? err.message : 'No pudimos publicar el pin.');
    },
  });

  function handleDeleteCreative() {
    setConfirmingDeleteCreative(true);
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/creatives');
    }
  }

  function confirmDeleteCreative() {
    setConfirmingDeleteCreative(false);
    setDeleteError(null);
    deleteCreative.mutate();
  }

  function handleDeleteVersion(versionId: string) {
    setConfirmingDeleteVersionId(versionId);
  }

  async function confirmDeleteVersion(versionId: string) {
    setConfirmingDeleteVersionId(null);
    setDeleteError(null);
    try {
      await apiFetch<{ ok: true }>(`/api/versions/${versionId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['versions', creativeId] });
      queryClient.invalidateQueries({ queryKey: ['creative', creativeId] });
      queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
      if (selectedVersionId === versionId) {
        const remaining = (versions ?? []).filter((v) => v.id !== versionId);
        setSelectedVersionId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'No pudimos eliminar la versión.');
    }
  }

  function handlePlacePin(leftPct: number, topPct: number) {
    setPinDraft({ leftPct, topPct });
    setPinText('');
    setPinError(null);
  }

  function handlePinSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pinDraft || !pinText.trim()) return;
    // Convert UI percentages to basis points (0–10000) for the API.
    addPinComment.mutate({
      body: pinText.trim(),
      posX: Math.round(pinDraft.leftPct * 100),
      posY: Math.round(pinDraft.topPct * 100),
    });
  }

  function handlePinCancel() {
    setPinDraft(null);
    setPinText('');
    setPinError(null);
  }

  /** Seek the staff video to a DRAW comment's frame and pause it so its
   * strokes show over the frozen frame (mirrors the client seekToComment). */
  function seekToDraw(comment: Comment) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = (comment.startMs ?? 0) / 1000;
    video.pause();
    setPaused(true);
    setCurrentTimeMs(comment.startMs ?? 0);
  }

  async function handleCopyLink() {
    if (!magicLink) return;
    try {
      await navigator.clipboard.writeText(magicLink.url);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  }

  // Select the latest version (first, since the backend orders versionNo desc).
  useEffect(() => {
    if (versions && !selectedVersionId) {
      setSelectedVersionId(versions[0]?.id ?? null);
    }
  }, [versions, selectedVersionId]);

  // Clear pin draft and video playback state when switching versions.
  useEffect(() => {
    setPinDraft(null);
    setPinText('');
    setPinError(null);
    setCurrentTimeMs(0);
    setPaused(true);
  }, [selectedVersionId]);

  if (isError) {
    return (
      <div className="error-banner">
        <span>No pudimos cargar este creativo.</span>
        <button onClick={() => refetch()}>Reintentar</button>
      </div>
    );
  }

  if (isLoading || !creative) {
    return (
      <div className="detail-grid">
        <div className="filmstrip skeleton-row" />
        <div className="stage skeleton-row" />
        <div className="comment-panel skeleton-row" />
      </div>
    );
  }

  const selectedVersion = versions?.find((v) => v.id === selectedVersionId) ?? versions?.[0];

  return (
    <div>
      <div className="staff-topbar" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button className="link-btn" onClick={handleBack}>
            <i className="ti ti-arrow-left" aria-hidden="true" />
            Volver
          </button>
          <div className="breadcrumb" style={{ marginBottom: 0 }}>
            <button className="link-btn" onClick={() => router.push(`/campaigns/${creative.campaignId}`)}>
              Campaña
            </button>
            {' / '}
            {creative.title}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => mintMagicLink.mutate()} disabled={mintMagicLink.isPending}>
            <i className="ti ti-link" aria-hidden="true" />
            Enviar link al cliente
          </button>
          <button className="btn primary" onClick={() => router.push(`/upload/${creative.id}`)}>
            <i className="ti ti-upload" aria-hidden="true" />
            Subir nueva versión
          </button>
          <button className="btn red" onClick={handleDeleteCreative} disabled={deleteCreative.isPending}>
            <i className="ti ti-trash" aria-hidden="true" />
            Eliminar creativo
          </button>
        </div>
      </div>

      {magicLink && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: '12px 14px',
            border: '1px solid var(--paper-line)',
            borderRadius: 6,
            background: 'var(--paper-2)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="eyebrow" style={{ marginBottom: 0 }}>
              Link de acceso para el cliente
            </span>
            <code
              style={{
                fontSize: 12,
                wordBreak: 'break-all',
                color: 'var(--text)',
                background: '#fff',
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--paper-line)',
              }}
            >
              {magicLink.url}
            </code>
            {magicLink.expiresAt && (
              <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                expira {new Date(magicLink.expiresAt).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={handleCopyLink} disabled={!magicLink}>
              <i className="ti ti-copy" aria-hidden="true" />
              {linkCopied ? 'Copiado' : 'Copiar'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setMagicLink(null);
                setLinkCopied(false);
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          <span>{deleteError}</span>
          <button
            onClick={() => {
              setDeleteError(null);
              setMagicLink(null);
              setLinkCopied(false);
            }}
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="detail-grid">
        <div className="filmstrip">
          {loadingVersions &&
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="vthumb skeleton-row" />)}
          {versionsError && <span className="mono">No pudimos cargar las versiones.</span>}
          {(versions ?? []).map((version) => (
            <button
              key={version.id}
              className={version.id === selectedVersion?.id ? 'vthumb active' : 'vthumb'}
              onClick={() => setSelectedVersionId(version.id)}
            >
              <span
                role="button"
                title="Eliminar versión"
                className="vthumb-x"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteVersion(version.id);
                }}
              >
                ×
              </span>
              <div className="box" />
              <div className="mono">v{version.versionNo}</div>
            </button>
          ))}
        </div>

        <div className="stage">
          {selectedVersion ? (
            <>
              {/* Agregar pin toggle + hint */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                <button
                  className={`btn ${pinMode ? 'primary' : 'ghost'}`}
                  onClick={() => {
                    if (pinMode) {
                      setPinMode(false);
                      setPinDraft(null);
                      setPinText('');
                      setPinError(null);
                    } else {
                      setPinMode(true);
                    }
                  }}
                  type="button"
                >
                  <i className="ti ti-pin" aria-hidden="true" />
                  {pinMode ? 'Cancelar pin' : 'Agregar pin'}
                </button>
                {pinMode && !pinDraft && (
                  <span className="canvas-hint">
                    Hacé clic sobre el video/imagen para colocar el pin
                  </span>
                )}
              </div>

              <MediaPreview
                kind={creative.kind}
                version={selectedVersion}
                comments={selectedComments}
                pinMode={pinMode}
                pinDraft={pinDraft}
                onPlacePin={handlePlacePin}
                videoRef={videoRef}
                currentTimeMs={currentTimeMs}
                paused={paused}
                onTimeUpdate={setCurrentTimeMs}
                onPauseChange={setPaused}
              />

              {/* Pin draft popover — below the media, inside .stage (position: relative) */}
              {pinDraft && (
                <div className="pin-popover" onClick={(e) => e.stopPropagation()}>
                  <form onSubmit={handlePinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                      autoFocus
                      rows={2}
                      placeholder="¿Qué querés señalar en este punto?"
                      value={pinText}
                      onChange={(e) => setPinText(e.target.value)}
                    />
                    {pinError && <p className="field-error" style={{ margin: 0 }}>{pinError}</p>}
                    <div className="pin-popover-actions">
                      <button type="button" className="btn ghost" onClick={handlePinCancel}>
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="btn primary"
                        disabled={!pinText.trim() || addPinComment.isPending}
                      >
                        Confirmar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {selectedVersion.reviewStatus !== 'NONE' ? (
                <div className="decision-banner">
                  <StatusPill status={reviewStatusAsCreative(selectedVersion.reviewStatus)} />
                  <span>
                    Decisión registrada sobre la v{selectedVersion.versionNo}
                  </span>
                </div>
              ) : selectedVersion.state === 'READY' ? (
                <div className="decision-banner">
                  <span>En revisión — esperando la decisión del cliente.</span>
                </div>
              ) : (
                <div className="decision-banner">
                  <span>
                    {selectedVersion.state === 'PROCESSING' ? 'Procesando versión…' : 'Esta versión no puede revisarse todavía.'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="media-box">
              <i className="ti ti-photo-off" aria-hidden="true" />
            </div>
          )}
        </div>

        {selectedVersion && (
          <CommentThread
            versionId={selectedVersion.id}
            comments={selectedComments}
            onSeekDraw={selectedVersion.state === 'READY' ? seekToDraw : undefined}
          />
        )}
      </div>

      <ConfirmModal
        open={confirmingDeleteCreative}
        title="Eliminar creativo"
        message="¿Eliminar este creativo con todas sus versiones y comentarios? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        confirmIcon="ti ti-trash"
        busy={deleteCreative.isPending}
        onConfirm={confirmDeleteCreative}
        onCancel={() => setConfirmingDeleteCreative(false)}
      />

      {confirmingDeleteVersionId && (
        <ConfirmModal
          open
          title="Eliminar versión"
          message="¿Eliminar esta versión con sus comentarios? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          confirmIcon="ti ti-trash"
          onConfirm={() => void confirmDeleteVersion(confirmingDeleteVersionId)}
          onCancel={() => setConfirmingDeleteVersionId(null)}
        />
      )}
    </div>
  );
}

function MediaPreview({
  kind,
  version,
  comments,
  pinMode,
  pinDraft,
  onPlacePin,
  videoRef,
  currentTimeMs,
  paused,
  onTimeUpdate,
  onPauseChange,
}: {
  kind: CreativeKind;
  version: CreativeVersionSummary;
  comments?: Comment[];
  pinMode: boolean;
  pinDraft: PinDraft | null;
  onPlacePin: (leftPct: number, topPct: number) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTimeMs: number;
  paused: boolean;
  onTimeUpdate: (timeMs: number) => void;
  onPauseChange: (paused: boolean) => void;
}) {
  // Real media only when the version is READY; the video src must be the MP4
  // asset (posterUrl is just a frame capture and never plays).
  const videoSrc =
    version.state === 'READY' && version.videoUrl ? `/media/${version.videoUrl}` : null;
  const posterHref = version.posterUrl ? `/media/${version.posterUrl}` : undefined;
  const imageSrc = version.state === 'READY' && version.posterUrl ? `/media/${version.posterUrl}` : null;
  // Pin comments only — same filtered array/order used to number the list.
  const pinComments = (comments ?? []).filter((c) => c.anchor === 'PIN');
  // DRAW comments: only those with strokes are rendered over the media.
  const drawComments = (comments ?? []).filter((c) => c.anchor === 'DRAW' && (c.strokes?.length ?? 0) > 0);
  const mediaStyle = {
    maxWidth: '100%',
    maxHeight: 460,
    objectFit: 'contain' as const,
    display: 'block' as const,
    margin: '0 auto',
  };

  // When "Agregar pin" mode is active, translate a click on the media wrapper
  // (bounding box covers the rendered media area) to percentage coordinates.
  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (!pinMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const leftPct = ((e.clientX - rect.left) / rect.width) * 100;
    const topPct = ((e.clientY - rect.top) / rect.height) * 100;
    onPlacePin(leftPct, topPct);
  }

  /** Overlay the numbered pins (mirrors the client lightbox: id = i+1). */
  function overlay() {
    if (pinComments.length === 0) return null;
    return pinComments.map((comment, i) => (
      <div
        key={comment.id}
        className="pin"
        // posX/posY are 0..10000 basis points; /100 = percentage.
        style={{ top: `${(comment.posY ?? 0) / 100}%`, left: `${(comment.posX ?? 0) / 100}%` }}
        title={comment.body}
      >
        {i + 1}
      </div>
    ));
  }

  /** Read-mode drawing overlay for DRAW comment strokes. For VIDEO the strokes
   * only render while paused on the matching frame; for IMAGE they always
   * render (there is no pause concept). */
  function drawOverlay() {
    if (drawComments.length === 0) return null;
    return drawComments.map((comment) => {
      const showForVideo = Math.abs(currentTimeMs - (comment.startMs ?? 0)) < 150;
      const show = kind === 'IMAGE' || (paused && showForVideo);
      if (!show) return null;
      return (
        <DrawingOverlay
          key={comment.id}
          active={false}
          containerRef={stageRef}
          strokes={comment.strokes ?? []}
          paused
        />
      );
    });
  }

  const stageRef = useRef<HTMLDivElement | null>(null);

  if (kind === 'TEXT') {
    return (
      <div className="media-box text-preview">
        <p>{version.textBody ?? 'Sin contenido de texto.'}</p>
      </div>
    );
  }
  if (kind === 'VIDEO') {
    if (videoSrc) {
      return (
        <div
          ref={stageRef}
          style={{ position: 'relative', display: 'inline-block', width: '100%', cursor: pinMode ? 'crosshair' : undefined }}
          onClick={handleClick}
        >
          <video
            className="media-frame"
            src={videoSrc}
            poster={posterHref}
            controls
            muted
            playsInline
            style={mediaStyle}
            ref={videoRef}
            onTimeUpdate={(e) => onTimeUpdate(Math.round(e.currentTarget.currentTime * 1000))}
            onPlay={() => onPauseChange(false)}
            onPause={() => onPauseChange(true)}
            onLoadedMetadata={(e) => onTimeUpdate(0)}
          />
          {drawOverlay()}
          {overlay()}
          {pinDraft && (
            <div
              className="pin pin-draft"
              style={{ top: `${pinDraft.topPct}%`, left: `${pinDraft.leftPct}%` }}
            >
              +
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="media-box">
        <i className="ti ti-player-play" aria-hidden="true" />
      </div>
    );
  }
  if (imageSrc) {
    return (
      <div
        ref={stageRef}
        style={{ position: 'relative', display: 'inline-block', width: '100%', cursor: pinMode ? 'crosshair' : undefined }}
        onClick={handleClick}
      >
        <img className="media-frame" src={imageSrc} alt={`v${version.versionNo}`} style={mediaStyle} />
        {drawOverlay()}
        {overlay()}
        {pinDraft && (
          <div
            className="pin pin-draft"
            style={{ top: `${pinDraft.topPct}%`, left: `${pinDraft.leftPct}%` }}
          >
            +
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="media-box">
      <i className="ti ti-photo" aria-hidden="true" />
    </div>
  );
}

/** ReviewStatus (NONE/APPROVED/REJECTED/CHANGES_REQUESTED) → CreativeStatus for the pill. */
function reviewStatusAsCreative(status: Exclude<ReviewStatus, 'NONE'>): CreativeStatus {
  return status as CreativeStatus;
}
