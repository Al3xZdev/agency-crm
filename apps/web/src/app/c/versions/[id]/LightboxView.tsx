'use client';

import { MouseEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { apiFetch, ApiError } from '../../../../lib/api';
import type { ClientVersionDetail, Comment, ReviewDecision } from '../../../../lib/types';
import { VideoScrubber } from '../../../../components/client/VideoScrubber';

type DecisionChoice = 'APPROVED' | 'REJECTED' | 'REQUEST_CHANGES';

const DECISION_CONFIG: Record<
  DecisionChoice,
  { label: string; stampLabel: string; className: string }
> = {
  APPROVED: { label: 'Aprobar', stampLabel: 'Aprobado', className: 'approved' },
  REJECTED: { label: 'Rechazar', stampLabel: 'Rechazado', className: 'rejected' },
  REQUEST_CHANGES: { label: 'Solicitar cambios', stampLabel: 'Cambios solicitados', className: 'request_changes' },
};

const DEFAULT_VIDEO_DURATION_MS = 45000;

interface PinDraft {
  posX: number;
  posY: number;
  leftPct: number;
  topPct: number;
}

type CommentPayload = {
  body: string;
  anchor: 'PLAIN' | 'PIN' | 'RANGE';
  posX?: number;
  posY?: number;
  startMs?: number;
  endMs?: number;
};

export function LightboxView({ versionId }: { versionId: string }) {
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pinText, setPinText] = useState('');
  const [plainText, setPlainText] = useState('');
  const [pendingDecision, setPendingDecision] = useState<DecisionChoice | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
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
    if (kindOf(version) !== 'IMAGE' || isLocked(version)) return;
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

  // Highlights and scrolls to the matching comment in the panel, whether the
  // user clicked a pin marker or a scrubber segment.
  function focusComment(commentId: string) {
    setActiveCommentId(commentId);
    document
      .getElementById(`comment-${commentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const locked = isLocked(version);
  const pinComments = version.comments.filter((c) => c.anchor === 'PIN') ?? [];
  const rangeComments = version.comments.filter((c) => c.anchor === 'RANGE') ?? [];
  const plainComments = version.comments.filter((c) => c.anchor === 'PLAIN') ?? [];
  const durationMs = version.durationMs ?? DEFAULT_VIDEO_DURATION_MS;
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
          <div className="lb-canvas" onClick={handleCanvasClick}>
            <MediaContent version={version} mediaUrl={mediaUrl(version)} />

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

            {locked && version.reviewEvent && (
              <>
                <div className={`stamp ${version.reviewEvent.decision.toLowerCase()}`}>
                  {DECISION_CONFIG[version.reviewEvent.decision]?.stampLabel ?? version.reviewEvent.decision}
                </div>
                <div className="stamp-meta">
                  {formatDecision(version.reviewEvent.decision)} por {version.reviewEvent.actorLabel} ·{' '}
                  {formatDate(version.reviewEvent.occurredAt)}
                </div>
              </>
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

          {kind === 'IMAGE' && !locked && !pinDraft && (
            <p className="canvas-hint">Hacé clic sobre la imagen para dejar un comentario en un punto específico.</p>
          )}

          {kind === 'VIDEO' && (
            <VideoScrubber
              durationMs={durationMs}
              comments={rangeComments}
              disabled={locked}
              activeCommentId={activeCommentId}
              onCreateRange={submitRange}
              onSelectComment={focusComment}
            />
          )}
        </div>

        <div className="lb-comments">
          {locked && (
            <div className="locked-banner">
              <i className="ti ti-lock" aria-hidden="true" />
              Esta versión ya tiene una decisión vinculante. No se puede volver a aprobar o rechazar.
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
                    <span className="who">{comment.authorLabel}</span>
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
                    <span className="who">{comment.authorLabel}</span>
                    <span className="pinref">
                      {formatMs(comment.startMs ?? 0)}–{formatMs(comment.endMs ?? comment.startMs ?? 0)}
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
                    <span className="who">{comment.authorLabel}</span>
                    <div className="txt">{comment.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!locked && (
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
          )}
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
              <button className="btn ghost" onClick={() => setPendingDecision(null)}>
                Cancelar
              </button>
              <button
                className={`btn ${DECISION_CONFIG[pendingDecision].className === 'request_changes' ? 'outline' : DECISION_CONFIG[pendingDecision].className}`}
                onClick={() => decide.mutate(pendingDecision)}
                disabled={decide.isPending}
              >
                {decide.isPending ? 'Enviando…' : 'Confirmar'}
              </button>
            </div>
          ) : (
            <>
              <button className="btn red" onClick={() => setPendingDecision('REJECTED')}>
                <i className="ti ti-x" aria-hidden="true" /> Rechazar
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
  return version.reviewEvent != null;
}

function mediaUrl(version: ClientVersionDetail): string | null {
  return version.asset ? `/api/media/${version.asset.storageKey}` : null;
}

/** Derive the visual kind from the asset mime; TEXT when there's a textBody. */
function kindOf(version: ClientVersionDetail): 'IMAGE' | 'VIDEO' | 'TEXT' {
  const mime = version.asset?.mime ?? '';
  if (mime.startsWith('image')) return 'IMAGE';
  if (mime.startsWith('video')) return 'VIDEO';
  if (version.textBody) return 'TEXT';
  return 'IMAGE';
}

function MediaContent({ version, mediaUrl }: { version: ClientVersionDetail; mediaUrl: string | null }) {
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
        src={version.posterUrl || mediaUrl || undefined}
        alt={`${version.creativeTitle} v${version.versionNo}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }
  if (mime.startsWith('video')) {
    return (
      <video
        src={mediaUrl || undefined}
        poster={version.posterUrl || undefined}
        controls
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
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
      return 'Rechazado';
    case 'REQUEST_CHANGES':
      return 'Cambios solicitados';
    default:
      return d.replace(/_/g, ' ');
  }
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
