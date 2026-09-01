'use client';

import { MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';

import { formatMs } from '../../lib/format';
import type { Comment } from '../../lib/types';

interface RangeDraft {
  startMs: number;
  endMs: number;
}

export function VideoScrubber({
  durationMs,
  comments,
  disabled,
  activeCommentId,
  onCreateRange,
  onSelectComment,
}: {
  durationMs: number | null;
  comments: Comment[];
  disabled: boolean;
  activeCommentId: string | null;
  onCreateRange: (startMs: number, endMs: number, body: string) => void;
  onSelectComment: (commentId: string) => void;
}) {
  // Use the REAL video duration only. A null/0 duration means the metadata
  // hasn't loaded yet — range creation is disabled until we know the true
  // length, so a drag is never interpreted against a fabricated total. The
  // track still renders (clamped to 0) while disabled.
  const totalMs = durationMs && durationMs > 0 ? durationMs : 0;
  const hasDuration = totalMs > 0;
  const isDisabled = disabled || !hasDuration;

  const trackRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<RangeDraft | null>(null);
  const [draftText, setDraftText] = useState('');

  function msFromClientX(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampMs(Math.round(pct * totalMs));
  }

  function clampMs(ms: number): number {
    return Math.min(totalMs, Math.max(0, ms));
  }

  function handleMouseDown(e: ReactMouseEvent) {
    // Never start a range while disabled OR before the real duration is known.
    if (disabled || totalMs <= 0) return;
    const ms = msFromClientX(e.clientX);
    anchorRef.current = ms;
    setDragging(true);
    setDraft({ startMs: ms, endMs: ms });
    setDraftText('');
  }

  // The drag can leave the track, so we listen on window while it lasts.
  useEffect(() => {
    if (!dragging) return;

    function handleMove(e: globalThis.MouseEvent) {
      if (anchorRef.current === null) return;
      const ms = msFromClientX(e.clientX);
      const anchor = anchorRef.current;
      setDraft({
        startMs: clampMs(Math.min(anchor, ms)),
        endMs: clampMs(Math.max(anchor, ms)),
      });
    }

    function handleUp() {
      setDragging(false);
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function submitDraft() {
    if (!draft || !draftText.trim()) return;
    // A plain click (no drag) yields a zero-width draft; give it a natural
    // 500ms-wide point comment instead. A real drag always keeps the actual
    // endMs captured while dragging — never re-clamped here.
    const endMs =
      draft.endMs === draft.startMs ? clampMs(draft.startMs + 500) : draft.endMs;
    onCreateRange(draft.startMs, endMs, draftText.trim());
    setDraft(null);
    setDraftText('');
  }

  const displayEndForDraft = draft
    ? draft.endMs === draft.startMs
      ? clampMs(draft.startMs + 500)
      : draft.endMs
    : 0;

  return (
    <div className="scrubber">
      <div
        ref={trackRef}
        className={isDisabled ? 'scrubber-track disabled' : 'scrubber-track'}
        onMouseDown={handleMouseDown}
      >
        {comments.map((comment, i) => {
          const start = clampMs(comment.startMs ?? 0);
          const end = clampMs(comment.endMs ?? start);
          const leftPct = (start / totalMs) * 100;
          const widthPct = Math.max(0.8, ((end - start) / totalMs) * 100);
          return (
            <div
              key={comment.id}
              className={
                comment.id === activeCommentId ? 'scrubber-segment active' : 'scrubber-segment'
              }
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={comment.body}
              onClick={(e) => {
                e.stopPropagation();
                onSelectComment(comment.id);
              }}
            >
              <span className="scrubber-segment-num">{i + 1}</span>
            </div>
          );
        })}

        {draft && (
          <div
            className="scrubber-draft"
            style={{
              left: `${(draft.startMs / totalMs) * 100}%`,
              width: `${Math.max(0.5, ((draft.endMs - draft.startMs) / totalMs) * 100)}%`,
            }}
          />
        )}
      </div>

      <div className="scrubber-times">
        <span>{formatMs(0)}</span>
        <span>{formatMs(totalMs)}</span>
      </div>

      {draft && !dragging && (
        <div className="pin-popover scrubber-popover" onClick={(e) => e.stopPropagation()}>
          <div className="scrubber-popover-range">
            {formatMs(draft.startMs)} – {formatMs(displayEndForDraft)}
          </div>
          <textarea
            autoFocus
            rows={2}
            placeholder="¿Qué pasa en este momento del video?"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitDraft();
              }
            }}
          />
          <div className="pin-popover-actions">
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button className="btn primary" onClick={submitDraft} disabled={!draftText.trim()}>
              Comentar
            </button>
          </div>
        </div>
      )}

      {!isDisabled && !draft && (
        <p className="canvas-hint">Arrastrá sobre la línea de tiempo para comentar un tramo del video.</p>
      )}
    </div>
  );
}

