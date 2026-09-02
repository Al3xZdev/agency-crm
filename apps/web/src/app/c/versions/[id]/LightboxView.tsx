'use client';

import { MouseEvent, RefObject, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import type { StrokeInput } from '@agency-crm/shared';
import { apiFetch, ApiError } from '../../../../lib/api';
import { formatDate, formatMs } from '../../../../lib/format';
import type { ClientVersionDetail, Comment, ReviewDecision } from '../../../../lib/types';
import { VideoScrubber } from '../../../../components/client/VideoScrubber';
import { DrawingOverlay } from '../../../../components/client/DrawingOverlay';

type DecisionChoice = 'APPROVED' | 'REJECTED' | 'REQUEST_CHANGES';

const DECISION_CONFIG: Record<
  DecisionChoice,
  { label: string; stampLabel: string; className: string }
> = {
  APPROVED: { label: 'Aprobar', stampLabel: 'Aprobado', className: 'approved' },
  REJECTED: { label: 'No aprobado', stampLabel: 'No aprobado', className: 'rejected' },
  REQUEST_CHANGES: { label: 'Solicitar cambios', stampLabel: 'Cambios solicitados', className: 'request_changes' },
};

interface PinDraft {
  posX: number;
  posY: number;
  leftPct: number;
  topPct: number;
}

type CommentPayload = {
  body: string;
  anchor: 'PLAIN' | 'PIN' | 'RANGE' | 'DRAW';
  posX?: number;
  posY?: number;
  startMs?: number;
  endMs?: number;
  strokes?: StrokeInput[];
};

export function LightboxView({ versionId }: { versionId: string }) {
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pinText, setPinText] = useState('');
  const [plainText, setPlainText] = useState('');
  const [pendingDecision, setPendingDecision] = useState<DecisionChoice | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // Live video duration captured from the media element; used only as a
  // fallback when the API doesn't return durationMs.
  const [realDurationMs, setRealDurationMs] = useState<number | null>(null);
  // Live playback position (ms) and pause state — drive DRAW read overlays
  // (frozen-frame matching) and the DRAW startMs anchor.
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [paused, setPaused] = useState(true);
  // DRAW writer mode: active while the user draws on the frozen frame.
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawStartMs, setDrawStartMs] = useState<number | null>(null);
  // The video stage (positions overlays) and the media element itself.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: version, isLoading, isError } = useQuery({
    queryKey: ['c-version', versionId],
    queryFn: () => apiFetch<ClientVersionDetail>(`/api/c/versions/${versionId}`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: CommentPayload) =>
      apiFetch<Comment>(`/api/c/versions/${versionId}/comments`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['c-version', versionId] });
      setPinDraft(null);
      setPinText('');
      setPlainText('');
      setDrawingEnabled(false);
      setDrawStartMs(null);
    },
  });

  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      apiFetch<{ id: string; decision: ReviewDecision }>(`/api/c/versions/${versionId}/decision`, {
        method: 'POST',
        body: { decision },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['c-version', versionId] });
      setPendingDecision(null);
      setRejectionReason('');
    },
    onError: (err: Error) => {
      // 409 = a decision already exists for this version (one per version,
      // cannot be changed afterward).
      setDecisionError(
        err instanceof ApiError && err.status === 409
          ? 'Esta versión ya tiene una decisión registrada.'
          : 'No pudimos registrar tu decisión. Intentá de nuevo.',
      );
      setPendingDecision(null);
    },
  });

  // Confirm a pending decision. For REJECTED ("No aprobado") a justification
  // comment is required and is persisted as a PLAIN comment before the vote is
  // cast; APPROVED / REQUEST_CHANGES need no comment.
  async function confirmDecision() {
    if (!pendingDecision) return;
    if (pendingDecision === 'REJECTED') {
      const reason = rejectionReason.trim();
      if (!reason) return;
      try {
        await apiFetch<Comment>(`/api/c/versions/${versionId}/comments`, {
          method: 'POST',
          body: { body: reason, anchor: 'PLAIN' },
        });
      } catch (err) {
        setDecisionError(
          'No pudimos guardar tu justificación. Intentá de nuevo.',
        );
        return;
      }
    }
    decide.mutate(pendingDecision);
  }

  // Keyboard nav: Escape closes, arrows change versions. Ignored when the
  // focus is on an input/textarea so we don't interfere with typing.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = document.activeElement as HTMLElement | null;
      if (target) {
        const tag = (target.tagName ?? '').toLowerCase();
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          target.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
      }

      if (e.key === 'Escape') {
        router.push('/c');
        return;
      }
      if (!version || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;

      const targetVersion =
        e.key === 'ArrowLeft' ? version.siblingVersions.previous : version.siblingVersions.next;
      if (targetVersion) router.push(`/c/versions/${targetVersion.id}`);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [version, router]);

  function handleCanvasClick(e: MouseEvent<HTMLDivElement>) {
    if (!version) return;
    // Allow pin placement on IMAGE and VIDEO alike (click-to-place on the
    // stage, matching the staff implementation). Skip while drawing on a
    // frozen frame; clicks on the video frame are allowed so clients can pin
    // points directly on the video (the position math uses the canvas rect).
    if (drawingEnabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const leftPct = ((e.clientX - rect.left) / rect.width) * 100;
    const topPct = ((e.clientY - rect.top) / rect.height) * 100;
    // Repo posX/posY are ints in 0..10000.
    setPinDraft({ posX: Math.round(leftPct * 100), posY: Math.round(topPct * 100), leftPct, topPct });
    setPinText('');
  }

  function submitPin() {
    if (!pinDraft || !pinText.trim()) return;
    addComment.mutate({ body: pinText.trim(), anchor: 'PIN', posX: pinDraft.posX, posY: pinDraft.posY });
  }

  function submitPlain() {
    if (!plainText.trim()) return;
    addComment.mutate({ body: plainText.trim(), anchor: 'PLAIN' });
  }

  function submitRange(startMs: number, endMs: number, body: string) {
    addComment.mutate({ body, anchor: 'RANGE', startMs, endMs });
  }

  /** Enter DRAW writer mode: freeze the frame and anchor the comment there. */
  function startDrawing() {
    const video = videoRef.current;
    video?.pause();
    setPaused(true);
    setDrawStartMs(Math.round((video?.currentTime ?? currentTimeMs / 1000) * 1000));
    setDrawingEnabled(true);
  }

  /** Persist the drawn strokes as a DRAW comment anchored at the frozen frame. */
  function commitDrawing(strokes: StrokeInput[], note: string) {
    if (drawStartMs === null || strokes.length === 0) return;
    let minX = 10000;
    let minY = 10000;
    let maxX = 0;
    let maxY = 0;
    for (const stroke of strokes) {
      for (const point of stroke.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
    const payload: CommentPayload = { body: note.trim(), anchor: 'DRAW', startMs: drawStartMs, strokes };
    // posX/posY = bbox center of the strokes (basis points), when meaningful.
    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);
    if (centerX > 0) payload.posX = centerX;
    if (centerY > 0) payload.posY = centerY;
    addComment.mutate(payload);
  }

  /** Discard a DRAW draft and leave writer mode. */
  function cancelDrawing() {
    setDrawingEnabled(false);
    setDrawStartMs(null);
  }

  /** Seek the video to a DRAW comment's frame, pause it, and highlight the comment. */
  function seekToComment(comment: Comment) {
    focusComment(comment.id);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = (comment.startMs ?? 0) / 1000;
    video.pause();
    setPaused(true);
  }

  // Highlights and scrolls to the matching comment in the panel, whether the
  // user clicked a pin marker or a scrubber segment.
  function focusComment(commentId: string) {
    setActiveCommentId(commentId);
    document
      .getElementById(`comment-${commentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => setActiveCommentId((current) => (current === commentId ? null : current)), 2000);
  }

  if (isError) {
    return (
      <div className="lightbox">
        <div className="error-banner" style={{ margin: 20 }}>
          <span>No pudimos cargar esta versión.</span>
        </div>
      </div>
    );
  }

  if (isLoading || !version) {
    return (
      <div className="lightbox">
        <div className="lb-top">
          <div className="meta skeleton-row" style={{ width: 200, height: 12 }} />
        </div>
        <div className="lb-body">
          <div className="lb-versions" />
          <div className="lb-stage">
            <div className="lb-canvas skeleton-row" />
          </div>
          <div className="lb-comments" />
        </div>
      </div>
    );
  }

  const hasDecision = isLocked(version);
  // `locked` means the client cannot RE-VOTE once a decision exists. It does
  // NOT block commenting / pins / drawing.
  const locked = hasDecision;
  const pinComments = version.comments.filter((c) => c.anchor === 'PIN') ?? [];
  const rangeComments = version.comments.filter((c) => c.anchor === 'RANGE') ?? [];
  const drawComments = version.comments.filter((c) => c.anchor === 'DRAW') ?? [];
  const plainComments = version.comments.filter((c) => c.anchor === 'PLAIN') ?? [];
  // API durationMs is primary; live element duration is the fallback. We do
  // NOT default to a fabricated value here: the scrubber must only enable once
  // a REAL duration is known, otherwise a drag gets interpreted against a
  // wrong total and saved range widths are corrupted.
  const durationMs = realDurationMs ?? version.durationMs;
  const kind = kindOf(version);

  return (
    <div className="lightbox">
      <div className="lb-top">
        <div className="meta">
          {version.creativeTitle.toLowerCase()} / v{version.versionNo}
        </div>
        <button className="lb-close" onClick={() => router.push('/c')}>
          <i className="ti ti-x" aria-hidden="true" /> cerrar <span className="kbd-hint">esc</span>
        </button>
      </div>

      <div className="lb-body">
        <div className="lb-versions">
          {version.siblingVersions.previous && (
            <button
              className="vdot"
              onClick={() => router.push(`/c/versions/${version.siblingVersions!.previous!.id}`)}
              title={`v${version.siblingVersions.previous.versionNo}`}
            >
              &larr; v{version.siblingVersions.previous.versionNo}
            </button>
          )}
          <span className="vdot current">v{version.versionNo}</span>
          {version.siblingVersions.next && (
            <button
              className="vdot"
              onClick={() => router.push(`/c/versions/${version.siblingVersions!.next!.id}`)}
              title={`v${version.siblingVersions.next.versionNo}`}
            >
              v{version.siblingVersions.next.versionNo} &rarr;
            </button>
          )}
        </div>

        <div className="lb-stage">
          {locked && version.reviewEvent && (
            <div className="lb-decision-banner">
              <div className={`banner-stamp ${version.reviewEvent.decision.toLowerCase()}`}>
                {DECISION_CONFIG[version.reviewEvent.decision]?.stampLabel ?? version.reviewEvent.decision}
              </div>
              <div className="banner-stamp-meta">
                {formatDecision(version.reviewEvent.decision)} por {version.reviewEvent.actorLabel} ·{' '}
                {formatDate(version.reviewEvent.occurredAt, true)}
              </div>
            </div>
          )}

          <div className="lb-canvas" ref={stageRef} onClick={handleCanvasClick}>
            <MediaContent
              version={version}
              mediaUrl={mediaUrl(version)}
              videoRef={videoRef}
              onVideoLoaded={setRealDurationMs}
              onTimeUpdate={setCurrentTimeMs}
              onPauseChange={setPaused}
            />

            {/* DRAW writer: capture strokes on the frozen frame (client only).
                Read overlays are hidden while writing. */}
            {kind === 'VIDEO' && drawingEnabled && drawStartMs !== null && (
              <DrawingOverlay
                active
                containerRef={stageRef}
                onCommit={commitDrawing}
                onCancel={cancelDrawing}
              />
            )}

            {/* DRAW reader: show any comment's strokes over the frame when it
                matches the paused playback position. */}
            {kind === 'VIDEO' &&
              !drawingEnabled &&
              paused &&
              drawComments.map(
                (comment) =>
                  Math.abs(currentTimeMs - (comment.startMs ?? 0)) < 150 && (
                    <DrawingOverlay
                      key={comment.id}
                      active={false}
                      containerRef={stageRef}
                      strokes={comment.strokes ?? []}
                      paused
                    />
                  ),
              )}

            {pinComments.map((comment, i) => (
              <div
                key={comment.id}
                className={comment.id === activeCommentId ? 'pin active' : 'pin'}
                // posX/posY are 0..10000; convert to percentage.
                style={{ top: `${(comment.posY ?? 0) / 100}%`, left: `${(comment.posX ?? 0) / 100}%` }}
                title={comment.body}
                onClick={(e) => {
                  e.stopPropagation();
                  focusComment(comment.id);
                }}
              >
                {i + 1}
              </div>
            ))}

            {pinDraft && (
              <div className="pin pin-draft" style={{ top: `${pinDraft.topPct}%`, left: `${pinDraft.leftPct}%` }}>
                +
              </div>
            )}
          </div>

          {pinDraft && (
            <div className="pin-popover" onClick={(e) => e.stopPropagation()}>
              <textarea
                autoFocus
                rows={2}
                placeholder="¿Qué le pasa a este punto?"
                value={pinText}
                onChange={(e) => setPinText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitPin();
                  }
                }}
              />
              <div className="pin-popover-actions">
                <button className="btn ghost" onClick={() => setPinDraft(null)}>
                  Cancelar
                </button>
                <button className="btn primary" onClick={submitPin} disabled={!pinText.trim() || addComment.isPending}>
                  Comentar
                </button>
              </div>
            </div>
          )}

          {kind !== 'TEXT' && !pinDraft && !drawingEnabled && (
            <p className="canvas-hint">
              Hacé clic sobre {kind === 'IMAGE' ? 'la imagen' : 'el video'} para dejar un comentario en un punto específico.
            </p>
          )}

          {kind === 'VIDEO' && (
            <VideoScrubber
              durationMs={durationMs}
              comments={rangeComments}
              disabled={!durationMs}
              activeCommentId={activeCommentId}
              onCreateRange={submitRange}
              onSelectComment={focusComment}
            />
          )}

          {kind === 'VIDEO' && !drawingEnabled && (
            <div className="drawing-toolbar">
              <button
                className="btn ghost"
                onClick={startDrawing}
                disabled={!paused}
                title={paused ? 'Draw on the paused frame' : 'Pause the video to draw'}
              >
                <i className="ti ti-brush" aria-hidden="true" /> Draw
              </button>
            </div>
          )}
        </div>

        <div className="lb-comments">
          {hasDecision && (
            <div className="locked-banner">
              <i className="ti ti-lock" aria-hidden="true" />
              Esta versión ya tiene una decisión. No se puede volver a votar.
            </div>
          )}

          <div className="lb-comments-list">
            <span className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
              Comentarios {version.comments.length > 0 ? `· ${version.comments.length}` : ''}
            </span>
            {version.comments.length === 0 && (
              <p className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Sin comentarios todavía.
              </p>
            )}

            {pinComments.length > 0 && (
              <div className="lb-group">
                <span className="lb-group-label eyebrow">
                  Pins <span className="kbd-hint">punto</span>
                </span>
                {pinComments.map((comment, i) => (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={comment.id === activeCommentId ? 'lb-comment active' : 'lb-comment'}
                  >
                    <span className={`who is-${comment.authorType.toLowerCase()}`}>{comment.authorLabel}</span>
                    <span className="pinref">#{i + 1}</span>
                    <div className="txt">{comment.body}</div>
                  </div>
                ))}
              </div>
            )}

            {rangeComments.length > 0 && (
              <div className="lb-group">
                <span className="lb-group-label eyebrow">
                  Tramo <span className="kbd-hint">rango</span>
                </span>
                {rangeComments.map((comment) => (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={comment.id === activeCommentId ? 'lb-comment active' : 'lb-comment'}
                  >
                    <span className={`who is-${comment.authorType.toLowerCase()}`}>{comment.authorLabel}</span>
                    <span className="pinref">
                      {formatMs(comment.startMs ?? 0)}–{formatMs(comment.endMs ?? comment.startMs ?? 0)}
                    </span>
                    <div className="txt">{comment.body}</div>
                  </div>
                ))}
              </div>
            )}

            {drawComments.length > 0 && (
              <div className="lb-group">
                <span className="lb-group-label eyebrow">
                  <i className="ti ti-brush" aria-hidden="true" /> Drawing
                </span>
                {drawComments.map((comment) => (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={comment.id === activeCommentId ? 'lb-comment active' : 'lb-comment'}
                    onClick={() => seekToComment(comment)}
                    role="button"
                    title="Seek to this drawing"
                  >
                    <span className={`who is-${comment.authorType.toLowerCase()}`}>{comment.authorLabel}</span>
                    <span className="pinref">
                      <i className="ti ti-brush" aria-hidden="true" /> {formatMs(comment.startMs ?? 0)}
                    </span>
                    <div className="txt">{comment.body}</div>
                  </div>
                ))}
              </div>
            )}

            {plainComments.length > 0 && (
              <div className="lb-group">
                <span className="lb-group-label eyebrow">General</span>
                {plainComments.map((comment) => (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={comment.id === activeCommentId ? 'lb-comment active' : 'lb-comment'}
                  >
                    <span className={`who is-${comment.authorType.toLowerCase()}`}>{comment.authorLabel}</span>
                    <div className="txt">{comment.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lb-input">
            <textarea
              rows={2}
              placeholder="Agregar comentario general…"
              value={plainText}
              onChange={(e) => setPlainText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitPlain();
                }
              }}
            />
          </div>
        </div>
      </div>

      {decisionError && (
        <div className="error-banner" style={{ margin: '0 20px' }}>
          <span>{decisionError}</span>
        </div>
      )}

      {!locked && (
        <div className="lb-decide">
          {pendingDecision ? (
            <div className="decide-confirm">
              <span>
                ¿Confirmás «{DECISION_CONFIG[pendingDecision].label}»? No vas a poder cambiarlo después.
              </span>
              {pendingDecision === 'REJECTED' && (
                <textarea
                  rows={2}
                  required
                  placeholder="Contanos por qué no aprobás esta versión (requerido)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              )}
              <button className="btn ghost" onClick={() => setPendingDecision(null)}>
                Cancelar
              </button>
              <button
                className={`btn ${DECISION_CONFIG[pendingDecision].className === 'request_changes' ? 'outline' : DECISION_CONFIG[pendingDecision].className}`}
                onClick={() => confirmDecision()}
                disabled={decide.isPending || (pendingDecision === 'REJECTED' && !rejectionReason.trim())}
              >
                {decide.isPending ? 'Enviando…' : 'Confirmar'}
              </button>
            </div>
          ) : (
            <>
              <button className="btn red" onClick={() => setPendingDecision('REJECTED')}>
                <i className="ti ti-x" aria-hidden="true" /> No aprobado
              </button>
              <button className="btn outline" onClick={() => setPendingDecision('REQUEST_CHANGES')}>
                <i className="ti ti-repeat" aria-hidden="true" /> Solicitar cambios
              </button>
              <button className="btn green" onClick={() => setPendingDecision('APPROVED')}>
                <i className="ti ti-check" aria-hidden="true" /> Aprobar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- helpers ----

function isLocked(version: ClientVersionDetail): boolean {
  // The client decides; a decision only blocks RE-voting by the client. A
  // legacy STAFF-cast seal does not lock the client (the agency no longer
  // votes). ReviewEvent is append-only, so a stale staff seal is cleared as a
  // data fix rather than replaced through this API; either way the client is
  // only locked after THEY have already decided this version.
  return version.reviewEvent?.actorType === 'CLIENT';
}

function mediaUrl(version: ClientVersionDetail): string | null {
  return version.asset ? `/api/media/${version.asset.storageKey}` : null;
}

/** Prefix a storageKey (`assets/<sha256>`) with the media route. The backend
 * exposes `posterUrl` as the raw storageKey, which must not be used directly
 * as a URL (it would resolve relative to the current page -> 404). */
function mediaHref(storageKey: string | null | undefined): string | null {
  return storageKey ? `/api/media/${storageKey}` : null;
}

/** Derive the visual kind from the asset mime; TEXT when there's a textBody. */
function kindOf(version: ClientVersionDetail): 'IMAGE' | 'VIDEO' | 'TEXT' {
  const mime = version.asset?.mime ?? '';
  if (mime.startsWith('image')) return 'IMAGE';
  if (mime.startsWith('video')) return 'VIDEO';
  if (version.textBody) return 'TEXT';
  return 'IMAGE';
}

function MediaContent({
  version,
  mediaUrl,
  videoRef,
  onVideoLoaded,
  onTimeUpdate,
  onPauseChange,
}: {
  version: ClientVersionDetail;
  mediaUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoLoaded: (durationMs: number) => void;
  onTimeUpdate: (timeMs: number) => void;
  onPauseChange: (paused: boolean) => void;
}) {
  if (version.state === 'FAILED') {
    return (
      <div className="lb-text-content">
        <p>La generación falló{version.failReason ? `: ${version.failReason}` : ''}.</p>
      </div>
    );
  }

  const mime = version.asset?.mime ?? '';
  if (mime.startsWith('image')) {
    return (
      <img
        src={mediaHref(version.posterUrl) || mediaUrl || undefined}
        alt={`${version.creativeTitle} v${version.versionNo}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }
  if (mime.startsWith('video')) {
    return (
      <video
        ref={videoRef}
        src={mediaUrl || undefined}
        poster={mediaHref(version.posterUrl) || undefined}
        controls
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => onVideoLoaded(Math.round(e.currentTarget.duration * 1000))}
        onTimeUpdate={(e) => onTimeUpdate(Math.round(e.currentTarget.currentTime * 1000))}
        onPlay={() => onPauseChange(false)}
        onPause={() => onPauseChange(true)}
        style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }
  if (version.textBody) {
    return (
      <div className="lb-text-content">
        <p>{version.textBody}</p>
      </div>
    );
  }
  return <i className="ti ti-photo placeholder" aria-hidden="true" />;
}

function formatDecision(d: string): string {
  switch (d) {
    case 'APPROVED':
      return 'Aprobado';
    case 'REJECTED':
      return 'No aprobado';
    case 'REQUEST_CHANGES':
      return 'Cambios solicitados';
    default:
      return d.replace(/_/g, ' ');
  }
}

