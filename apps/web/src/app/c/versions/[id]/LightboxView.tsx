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
  APPROVED: {
    label: 'Aprobar',
    stampLabel: 'Aprobado',
    className: 'approved',
  },
  REJECTED: {
    label: 'No aprobado',
    stampLabel: 'No aprobado',
    className: 'rejected',
  },
  REQUEST_CHANGES: {
    label: 'Solicitar cambios',
    stampLabel: 'Cambios solicitados',
    className: 'request_changes',
  },
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
  const [pendingDecision, setPendingDecision] =
    useState<DecisionChoice | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  const [realDurationMs, setRealDurationMs] = useState<number | null>(null);

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [paused, setPaused] = useState(true);

  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawStartMs, setDrawStartMs] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: version,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['c-version', versionId],
    queryFn: () =>
      apiFetch<ClientVersionDetail>(`/api/c/versions/${versionId}`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: CommentPayload) =>
      apiFetch<Comment>(`/api/c/versions/${versionId}/comments`, {
        method: 'POST',
        body: payload,
      }),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['c-version', versionId],
      });

      setPinDraft(null);
      setPinText('');
      setPlainText('');
      setDrawingEnabled(false);
      setDrawStartMs(null);
    },
  });

  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      apiFetch<{ id: string; decision: ReviewDecision }>(
        `/api/c/versions/${versionId}/decision`,
        {
          method: 'POST',
          body: { decision },
        },
      ),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['c-version', versionId],
      });

      setPendingDecision(null);
      setRejectionReason('');
    },

    onError: (err: Error) => {
      setDecisionError(
        err instanceof ApiError && err.status === 409
          ? 'Esta versión ya tiene una decisión registrada.'
          : 'No pudimos registrar tu decisión. Intentá de nuevo.',
      );

      setPendingDecision(null);
    },
  });

  async function confirmDecision() {
    if (!pendingDecision) return;

    if (pendingDecision === 'REJECTED') {
      const reason = rejectionReason.trim();

      if (!reason) return;

      try {
        await apiFetch<Comment>(
          `/api/c/versions/${versionId}/comments`,
          {
            method: 'POST',
            body: {
              body: reason,
              anchor: 'PLAIN',
            },
          },
        );
      } catch {
        setDecisionError(
          'No pudimos guardar tu justificación. Intentá de nuevo.',
        );
        return;
      }
    }

    decide.mutate(pendingDecision);
  }

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

      if (
        !version ||
        (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
      ) {
        return;
      }

      const targetVersion =
        e.key === 'ArrowLeft'
          ? version.siblingVersions.previous
          : version.siblingVersions.next;

      if (targetVersion) {
        router.push(`/c/versions/${targetVersion.id}`);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () =>
      window.removeEventListener('keydown', handleKeyDown);
  }, [version, router]);

  function handleCanvasClick(e: MouseEvent<HTMLDivElement>) {
    if (!version) return;
    if (drawingEnabled) return;

    const rect = e.currentTarget.getBoundingClientRect();

    const leftPct =
      ((e.clientX - rect.left) / rect.width) * 100;

    const topPct =
      ((e.clientY - rect.top) / rect.height) * 100;

    setPinDraft({
      posX: Math.round(leftPct * 100),
      posY: Math.round(topPct * 100),
      leftPct,
      topPct,
    });

    setPinText('');
  }

  function submitPin() {
    if (!pinDraft || !pinText.trim()) return;

    const video = videoRef.current;

    addComment.mutate({
      body: pinText.trim(),
      anchor: 'PIN',
      posX: pinDraft.posX,
      posY: pinDraft.posY,
      startMs: Math.round(
        (video?.currentTime ?? currentTimeMs / 1000) * 1000,
      ),
    });
  }

  function submitPlain() {
    if (!plainText.trim()) return;

    addComment.mutate({
      body: plainText.trim(),
      anchor: 'PLAIN',
    });
  }

  function submitRange(
    startMs: number,
    endMs: number,
    body: string,
  ) {
    addComment.mutate({
      body,
      anchor: 'RANGE',
      startMs,
      endMs,
    });
  }

  function startDrawing() {
    const video = videoRef.current;

    video?.pause();

    setPaused(true);

    setDrawStartMs(
      Math.round(
        (video?.currentTime ?? currentTimeMs / 1000) * 1000,
      ),
    );

    setDrawingEnabled(true);
  }

  function commitDrawing(
    strokes: StrokeInput[],
    note: string,
  ) {
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

    const payload: CommentPayload = {
      body: note.trim(),
      anchor: 'DRAW',
      startMs: drawStartMs,
      strokes,
    };

    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);

    if (centerX > 0) payload.posX = centerX;
    if (centerY > 0) payload.posY = centerY;

    addComment.mutate(payload);
  }

  function cancelDrawing() {
    setDrawingEnabled(false);
    setDrawStartMs(null);
  }

  function seekToComment(comment: Comment) {
    focusComment(comment.id);

    const video = videoRef.current;

    if (!video) return;

    video.currentTime = (comment.startMs ?? 0) / 1000;
    video.pause();

    setPaused(true);
  }

  function focusComment(commentId: string) {
    setActiveCommentId(commentId);

    document
      .getElementById(`comment-${commentId}`)
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });

    setTimeout(() => {
      setActiveCommentId((current) =>
        current === commentId ? null : current,
      );
    }, 2000);
  }

  if (isError) {
    return (
      <div className="lightbox">
        <div className="lb-error-state">
          <div className="lb-error-icon">
            <i className="ti ti-alert-circle" aria-hidden="true" />
          </div>

          <h2>No pudimos cargar esta versión</h2>

          <p>
            Hubo un problema al cargar el creativo.
          </p>

          <button
            className="btn ghost"
            onClick={() => router.push('/c')}
          >
            Volver al portal
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !version) {
    return (
      <div className="lightbox">
        <div className="lb-top">
          <div className="lb-header-left">
            <div
              className="meta skeleton-row"
              style={{
                width: 220,
                height: 14,
              }}
            />
          </div>

          <div
            className="skeleton-row"
            style={{
              width: 90,
              height: 34,
              borderRadius: 10,
            }}
          />
        </div>

        <div className="lb-body">
          <div className="lb-versions" />

          <div className="lb-stage">
            <div className="lb-canvas skeleton-row" />
          </div>

          <div className="lb-comments">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        </div>
      </div>
    );
  }

  const hasDecision = isLocked(version);

  const locked = hasDecision;

  const pinComments =
    version.comments.filter(
      (c) => c.anchor === 'PIN',
    ) ?? [];

  const rangeComments =
    version.comments.filter(
      (c) => c.anchor === 'RANGE',
    ) ?? [];

  const drawComments =
    version.comments.filter(
      (c) => c.anchor === 'DRAW',
    ) ?? [];

  const plainComments =
    version.comments.filter(
      (c) => c.anchor === 'PLAIN',
    ) ?? [];

  const durationMs =
    realDurationMs ?? version.durationMs;

  const kind = kindOf(version);

  return (
    <div className="lightbox">
      {/* HEADER */}

      <header className="lb-top">
        <div className="lb-header-left">
          <button
            className="lb-back"
            onClick={() => router.push('/c')}
            type="button"
          >
            <i
              className="ti ti-arrow-left"
              aria-hidden="true"
            />
            <span>Volver</span>
          </button>

          <div className="lb-title-block">
            <div className="meta">
              {version.creativeTitle.toLowerCase()}
            </div>

            <div className="lb-version-label">
              Versión {version.versionNo}
            </div>
          </div>
        </div>

        <div className="lb-header-right">
          <div className="lb-keyboard-hint">
            <span>ESC</span>
            cerrar
          </div>

          <button
            className="lb-close"
            onClick={() => router.push('/c')}
            type="button"
            aria-label="Cerrar revisión"
          >
            <i
              className="ti ti-x"
              aria-hidden="true"
            />
            <span>Cerrar</span>
          </button>
        </div>
      </header>

      {/* MAIN REVIEW AREA */}

      <div className="lb-body">
        {/* VERSION NAVIGATION */}

        <aside className="lb-versions" aria-label="Versiones">
          <div className="lb-version-nav-label">
            VERSIONES
          </div>

          <div className="lb-version-nav">
            {version.siblingVersions.previous && (
              <button
                className="vdot"
                onClick={() =>
                  router.push(
                    `/c/versions/${version.siblingVersions!.previous!.id}`,
                  )
                }
                title={`v${version.siblingVersions.previous.versionNo}`}
                type="button"
              >
                <i
                  className="ti ti-chevron-left"
                  aria-hidden="true"
                />

                <span>
                  v{version.siblingVersions.previous.versionNo}
                </span>
              </button>
            )}

            <span
              className="vdot current"
              aria-current="page"
            >
              v{version.versionNo}
            </span>

            {version.siblingVersions.next && (
              <button
                className="vdot"
                onClick={() =>
                  router.push(
                    `/c/versions/${version.siblingVersions!.next!.id}`,
                  )
                }
                title={`v${version.siblingVersions.next.versionNo}`}
                type="button"
              >
                <span>
                  v{version.siblingVersions.next.versionNo}
                </span>

                <i
                  className="ti ti-chevron-right"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          <div className="lb-version-help">
            <i
              className="ti ti-arrows-left-right"
              aria-hidden="true"
            />

            <span>
              Usá ← → para cambiar
            </span>
          </div>
        </aside>

        {/* MEDIA / CANVAS */}

        <section className="lb-stage">
          {locked && version.reviewEvent && (
            <div className="lb-decision-banner">
              <div className="lb-decision-banner-icon">
                <i
                  className={
                    version.reviewEvent.decision === 'APPROVED'
                      ? 'ti ti-check'
                      : version.reviewEvent.decision === 'REJECTED'
                        ? 'ti ti-x'
                        : 'ti ti-refresh'
                  }
                  aria-hidden="true"
                />
              </div>

              <div className="lb-decision-banner-content">
                <strong>
                  {DECISION_CONFIG[
                    version.reviewEvent.decision as DecisionChoice
                  ]?.stampLabel ??
                    formatDecision(
                      version.reviewEvent.decision,
                    )}
                </strong>

                <span>
                  {formatDecision(
                    version.reviewEvent.decision,
                  )}{' '}
                  por {version.reviewEvent.actorLabel} ·{' '}
                  {formatDate(
                    version.reviewEvent.occurredAt,
                    true,
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="lb-media-shell">
            <div
              className="lb-canvas"
              ref={stageRef}
              onClick={handleCanvasClick}
            >
              <MediaContent
                version={version}
                mediaUrl={mediaUrl(version)}
                videoRef={videoRef}
                onVideoLoaded={setRealDurationMs}
                onTimeUpdate={setCurrentTimeMs}
                onPauseChange={setPaused}
              />

              {/* DRAW WRITER */}

              {kind === 'VIDEO' &&
                drawingEnabled &&
                drawStartMs !== null && (
                  <DrawingOverlay
                    active
                    containerRef={stageRef}
                    onCommit={commitDrawing}
                    onCancel={cancelDrawing}
                  />
                )}

              {/* DRAW READER */}

              {kind === 'VIDEO' &&
                !drawingEnabled &&
                paused &&
                drawComments.map(
                  (comment) =>
                    Math.abs(
                      currentTimeMs -
                        (comment.startMs ?? 0),
                    ) < 150 && (
                      <DrawingOverlay
                        key={comment.id}
                        active={false}
                        containerRef={stageRef}
                        strokes={comment.strokes ?? []}
                        paused
                      />
                    ),
                )}

              {/* PIN COMMENTS */}

              {pinComments.map((comment, i) => (
                <div
                  key={comment.id}
                  className={
                    comment.id === activeCommentId
                      ? 'pin active'
                      : 'pin'
                  }
                  style={{
                    top: `${(comment.posY ?? 0) / 100}%`,
                    left: `${(comment.posX ?? 0) / 100}%`,
                  }}
                  title={comment.body}
                  onClick={(e) => {
                    e.stopPropagation();
                    focusComment(comment.id);
                  }}
                >
                  {i + 1}
                </div>
              ))}

              {/* PIN DRAFT */}

              {pinDraft && (
                <div
                  className="pin pin-draft"
                  style={{
                    top: `${pinDraft.topPct}%`,
                    left: `${pinDraft.leftPct}%`,
                  }}
                >
                  +
                </div>
              )}
            </div>

            {/* PIN COMPOSER */}

            {pinDraft && (
              <div
                className="pin-popover"
                onClick={(e) =>
                  e.stopPropagation()
                }
              >
                <div className="pin-popover-header">
                  <div className="pin-popover-title">
                    <span className="pin-popover-number">
                      +
                    </span>

                    <div>
                      <strong>
                        Comentario sobre este punto
                      </strong>

                      <span>
                        Marcá qué debería cambiar
                      </span>
                    </div>
                  </div>
                </div>

                <textarea
                  autoFocus
                  rows={3}
                  placeholder="¿Qué le pasa a este punto?"
                  value={pinText}
                  onChange={(e) =>
                    setPinText(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey
                    ) {
                      e.preventDefault();
                      submitPin();
                    }
                  }}
                />

                <div className="pin-popover-actions">
                  <button
                    className="btn ghost"
                    onClick={() =>
                      setPinDraft(null)
                    }
                    type="button"
                  >
                    Cancelar
                  </button>

                  <button
                    className="btn primary"
                    onClick={submitPin}
                    disabled={
                      !pinText.trim() ||
                      addComment.isPending
                    }
                    type="button"
                  >
                    {addComment.isPending
                      ? 'Guardando…'
                      : 'Agregar comentario'}
                  </button>
                </div>
              </div>
            )}

            {/* CANVAS HINT */}

            {kind !== 'TEXT' &&
              !pinDraft &&
              !drawingEnabled && (
                <div className="canvas-hint">
                  <i
                    className="ti ti-map-pin"
                    aria-hidden="true"
                  />

                  <span>
                    Hacé clic sobre{' '}
                    {kind === 'IMAGE'
                      ? 'la imagen'
                      : 'el video'}{' '}
                    para comentar un punto específico.
                  </span>
                </div>
              )}

            {/* VIDEO SCRUBBER */}

            {kind === 'VIDEO' && (
              <div className="lb-scrubber-wrap">
                <VideoScrubber
                  durationMs={durationMs}
                  comments={rangeComments}
                  disabled={!durationMs}
                  activeCommentId={activeCommentId}
                  onCreateRange={submitRange}
                  onSelectComment={focusComment}
                />
              </div>
            )}

            {/* DRAW TOOL */}

            {kind === 'VIDEO' &&
              !drawingEnabled && (
                <div className="drawing-toolbar">
                  <button
                    className="btn ghost"
                    onClick={startDrawing}
                    disabled={!paused}
                    title={
                      paused
                        ? 'Dibujar sobre el fotograma pausado'
                        : 'Pausá el video para dibujar'
                    }
                    type="button"
                  >
                    <i
                      className="ti ti-brush"
                      aria-hidden="true"
                    />

                    <span>Dibujar sobre el video</span>

                    {!paused && (
                      <span className="drawing-disabled-label">
                        Pausá primero
                      </span>
                    )}
                  </button>
                </div>
              )}
          </div>
        </section>

        {/* COMMENTS */}

        <aside className="lb-comments">
          <div className="lb-comments-header">
            <div>
              <span className="eyebrow">
                Revisión
              </span>

              <h2>
                Comentarios
                {version.comments.length > 0 && (
                  <span className="lb-comment-count">
                    {version.comments.length}
                  </span>
                )}
              </h2>
            </div>

            <div className="lb-comments-header-icon">
              <i
                className="ti ti-message-2"
                aria-hidden="true"
              />
            </div>
          </div>

          {hasDecision && (
            <div className="locked-banner">
              <div className="locked-banner-icon">
                <i
                  className="ti ti-lock"
                  aria-hidden="true"
                />
              </div>

              <div>
                <strong>
                  Revisión finalizada
                </strong>

                <span>
                  Esta versión ya tiene una decisión.
                  No se puede volver a votar.
                </span>
              </div>
            </div>
          )}

          <div className="lb-comments-list">
            {version.comments.length === 0 && (
              <div className="lb-comments-empty">
                <div className="lb-comments-empty-icon">
                  <i
                    className="ti ti-message-off"
                    aria-hidden="true"
                  />
                </div>

                <strong>
                  Sin comentarios todavía
                </strong>

                <p>
                  Hacé clic sobre el material para
                  señalar un punto o agregá un
                  comentario general.
                </p>
              </div>
            )}

            {pinComments.length > 0 && (
              <div className="lb-group">
                <div className="lb-group-header">
                  <span className="lb-group-label eyebrow">
                    <i
                      className="ti ti-map-pin"
                      aria-hidden="true"
                    />
                    Pins
                  </span>

                  <span className="kbd-hint">
                    punto
                  </span>
                </div>

                {pinComments.map(
                  (comment, i) => (
                    <div
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className={
                        comment.id ===
                        activeCommentId
                          ? 'lb-comment active'
                          : 'lb-comment'
                      }
                    >
                      <div className="lb-comment-top">
                        <span
                          className={`who is-${comment.authorType.toLowerCase()}`}
                        >
                          {comment.authorLabel}
                        </span>

                        <span className="lb-time-badge" title={comment.body}>
                          <i className="ti ti-pin" aria-hidden="true" />
                          #{i + 1} · {formatMs(comment.startMs ?? 0)}
                        </span>
                      </div>

                      <div className="txt">
                        {comment.body}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}

            {rangeComments.length > 0 && (
              <div className="lb-group">
                <div className="lb-group-header">
                  <span className="lb-group-label eyebrow">
                    <i
                      className="ti ti-timeline"
                      aria-hidden="true"
                    />
                    Tramos
                  </span>

                  <span className="kbd-hint">
                    rango
                  </span>
                </div>

                {rangeComments.map(
                  (comment) => (
                    <div
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className={
                        comment.id ===
                        activeCommentId
                          ? 'lb-comment active'
                          : 'lb-comment'
                      }
                    >
                      <div className="lb-comment-top">
                        <span
                          className={`who is-${comment.authorType.toLowerCase()}`}
                        >
                          {comment.authorLabel}
                        </span>

                        <span className="lb-time-badge">
                          <i className="ti ti-timeline" aria-hidden="true" />
                          {formatMs(comment.startMs ?? 0)} – {formatMs(comment.endMs ?? comment.startMs ?? 0)}
                        </span>
                      </div>

                      <div className="txt">
                        {comment.body}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}

            {drawComments.length > 0 && (
              <div className="lb-group">
                <div className="lb-group-header">
                  <span className="lb-group-label eyebrow">
                    <i
                      className="ti ti-brush"
                      aria-hidden="true"
                    />
                    Dibujos
                  </span>
                </div>

                {drawComments.map(
                  (comment) => (
                    <div
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className={
                        comment.id ===
                        activeCommentId
                          ? 'lb-comment active'
                          : 'lb-comment'
                      }
                      onClick={() =>
                        seekToComment(comment)
                      }
                      role="button"
                      tabIndex={0}
                      title="Ir a este dibujo"
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' ||
                          e.key === ' '
                        ) {
                          e.preventDefault();
                          seekToComment(comment);
                        }
                      }}
                    >
                      <div className="lb-comment-top">
                        <span
                          className={`who is-${comment.authorType.toLowerCase()}`}
                        >
                          {comment.authorLabel}
                        </span>

                        <span className="lb-time-badge">
                          <i className="ti ti-brush" aria-hidden="true" />
                          {formatMs(comment.startMs ?? 0)}
                        </span>
                      </div>

                      <div className="txt">
                        {comment.body}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}

            {plainComments.length > 0 && (
              <div className="lb-group">
                <div className="lb-group-header">
                  <span className="lb-group-label eyebrow">
                    <i
                      className="ti ti-message"
                      aria-hidden="true"
                    />
                    General
                  </span>
                </div>

                {plainComments.map(
                  (comment) => (
                    <div
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className={
                        comment.id ===
                        activeCommentId
                          ? 'lb-comment active'
                          : 'lb-comment'
                      }
                    >
                      <div className="lb-comment-top">
                        <span
                          className={`who is-${comment.authorType.toLowerCase()}`}
                        >
                          {comment.authorLabel}
                        </span>
                      </div>

                      <div className="txt">
                        {comment.body}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* GENERAL COMMENT COMPOSER */}

          <div className="lb-input">
            <div className="lb-input-inner">
              <textarea
                rows={3}
                placeholder="Agregar comentario general…"
                value={plainText}
                onChange={(e) =>
                  setPlainText(e.target.value)
                }
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey
                  ) {
                    e.preventDefault();
                    submitPlain();
                  }
                }}
              />

              <div className="lb-input-footer">
                <span>
                  Enter para enviar · Shift + Enter
                  para nueva línea
                </span>

                <button
                  className="btn primary"
                  onClick={submitPlain}
                  disabled={
                    !plainText.trim() ||
                    addComment.isPending
                  }
                  type="button"
                >
                  <i
                    className="ti ti-send"
                    aria-hidden="true"
                  />

                  <span>
                    {addComment.isPending
                      ? 'Enviando…'
                      : 'Enviar'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* DECISION ERROR */}

      {decisionError && (
        <div
          className="error-banner lb-decision-error"
        >
          <i
            className="ti ti-alert-circle"
            aria-hidden="true"
          />

          <span>{decisionError}</span>

          <button
            type="button"
            onClick={() => setDecisionError(null)}
            aria-label="Cerrar error"
          >
            <i
              className="ti ti-x"
              aria-hidden="true"
            />
          </button>
        </div>
      )}

      {/* DECISION BAR */}

      {!locked && (
        <footer className="lb-decide">
          {pendingDecision ? (
            <div className="decide-confirm">
              <div className="decide-confirm-content">
                <div className="decide-confirm-icon">
                  <i
                    className={
                      pendingDecision ===
                      'APPROVED'
                        ? 'ti ti-check'
                        : pendingDecision ===
                            'REJECTED'
                          ? 'ti ti-x'
                          : 'ti ti-refresh'
                    }
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <strong>
                    ¿Confirmás «
                    {
                      DECISION_CONFIG[
                        pendingDecision
                      ].label
                    }
                    »?
                  </strong>

                  <span>
                    No vas a poder cambiar esta
                    decisión después.
                  </span>
                </div>
              </div>

              {pendingDecision ===
                'REJECTED' && (
                <textarea
                  rows={2}
                  required
                  placeholder="Contanos por qué no aprobás esta versión (requerido)"
                  value={rejectionReason}
                  onChange={(e) =>
                    setRejectionReason(
                      e.target.value,
                    )
                  }
                />
              )}

              <div className="decide-confirm-actions">
                <button
                  className="btn ghost"
                  onClick={() =>
                    setPendingDecision(null)
                  }
                  type="button"
                >
                  Cancelar
                </button>

                <button
                  className={`btn ${
                    DECISION_CONFIG[
                      pendingDecision
                    ].className ===
                    'request_changes'
                      ? 'outline'
                      : DECISION_CONFIG[
                            pendingDecision
                          ].className
                  }`}
                  onClick={() =>
                    confirmDecision()
                  }
                  disabled={
                    decide.isPending ||
                    (pendingDecision ===
                      'REJECTED' &&
                      !rejectionReason.trim())
                  }
                  type="button"
                >
                  {decide.isPending
                    ? 'Enviando…'
                    : 'Confirmar decisión'}
                </button>
              </div>
            </div>
          ) : (
            <div className="lb-decide-inner">
              <div className="lb-decide-copy">
                <span className="eyebrow">
                  Decisión final
                </span>

                <strong>
                  ¿Qué querés hacer con esta
                  versión?
                </strong>
              </div>

              <div className="lb-decide-actions">
                <button
                  className="btn red"
                  onClick={() =>
                    setPendingDecision(
                      'REJECTED',
                    )
                  }
                  type="button"
                >
                  <i
                    className="ti ti-x"
                    aria-hidden="true"
                  />
                  No aprobado
                </button>

                <button
                  className="btn outline"
                  onClick={() =>
                    setPendingDecision(
                      'REQUEST_CHANGES',
                    )
                  }
                  type="button"
                >
                  <i
                    className="ti ti-repeat"
                    aria-hidden="true"
                  />
                  Solicitar cambios
                </button>

                <button
                  className="btn green"
                  onClick={() =>
                    setPendingDecision(
                      'APPROVED',
                    )
                  }
                  type="button"
                >
                  <i
                    className="ti ti-check"
                    aria-hidden="true"
                  />
                  Aprobar
                </button>
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function isLocked(
  version: ClientVersionDetail,
): boolean {
  return (
    version.reviewEvent?.actorType === 'CLIENT'
  );
}

function mediaUrl(
  version: ClientVersionDetail,
): string | null {
  return version.asset
    ? `/api/media/${version.asset.storageKey}`
    : null;
}

function mediaHref(
  storageKey: string | null | undefined,
): string | null {
  return storageKey
    ? `/api/media/${storageKey}`
    : null;
}

function kindOf(
  version: ClientVersionDetail,
): 'IMAGE' | 'VIDEO' | 'TEXT' {
  const mime = version.asset?.mime ?? '';

  if (mime.startsWith('image')) {
    return 'IMAGE';
  }

  if (mime.startsWith('video')) {
    return 'VIDEO';
  }

  if (version.textBody) {
    return 'TEXT';
  }

  return 'IMAGE';
}

// -----------------------------------------------------------------------------
// MEDIA
// -----------------------------------------------------------------------------

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
      <div className="lb-text-content lb-media-error">
        <div className="lb-media-error-icon">
          <i
            className="ti ti-alert-triangle"
            aria-hidden="true"
          />
        </div>

        <p>
          La generación falló
          {version.failReason
            ? `: ${version.failReason}`
            : '.'}
        </p>
      </div>
    );
  }

  const mime = version.asset?.mime ?? '';

  if (mime.startsWith('image')) {
    return (
      <img
        src={
          mediaHref(version.posterUrl) ||
          mediaUrl ||
          undefined
        }
        alt={`${version.creativeTitle} v${version.versionNo}`}
        className="lb-media-image"
      />
    );
  }

  if (mime.startsWith('video')) {
    return (
      <video
        ref={videoRef}
        src={mediaUrl || undefined}
        poster={
          mediaHref(version.posterUrl) ||
          undefined
        }
        controls
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) =>
          onVideoLoaded(
            Math.round(
              e.currentTarget.duration * 1000,
            ),
          )
        }
        onTimeUpdate={(e) =>
          onTimeUpdate(
            Math.round(
              e.currentTarget.currentTime * 1000,
            ),
          )
        }
        onPlay={() => onPauseChange(false)}
        onPause={() => onPauseChange(true)}
        className="lb-media-video"
      />
    );
  }

  if (version.textBody) {
    return (
      <div className="lb-text-content">
        <div className="lb-text-content-label">
          <i
            className="ti ti-align-left"
            aria-hidden="true"
          />
          Texto
        </div>

        <p>{version.textBody}</p>
      </div>
    );
  }

  return (
    <div className="lb-media-placeholder">
      <i
        className="ti ti-photo"
        aria-hidden="true"
      />
    </div>
  );
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