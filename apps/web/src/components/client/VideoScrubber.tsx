'use client';

import { MouseEvent as ReactMouseEvent, useRef, useState } from 'react';

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

  // Two-click range selection: the first click marks the START POINT, the
  // second marks the END POINT. `startPick` holds the first click's ms while
  // we wait for the second click; `draft` is the finalized range.
  const [startPick, setStartPick] = useState<number | null>(null);
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

  function handleClick(e: ReactMouseEvent) {
    // Never start a range while disabled OR before the real duration is known.
    if (disabled || totalMs <= 0) return;

    const ms = msFromClientX(e.clientX);

    // First click: mark the START POINT and wait for the end point.
    if (startPick === null) {
      setStartPick(ms);
      setDraft(null);
      setDraftText('');
      return;
    }

    // Second click: finalize the range between the two points.
    const a = startPick;
    let endMs = Math.max(a, ms);
    const startMs = Math.min(a, ms);
    // Two clicks at the same spot: give it a small width for a point-in-time
    // comment instead of a zero-width (invisible) draft.
    if (startMs === endMs) {
      endMs = Math.min(totalMs, startMs + 500);
    }
    setDraft({ startMs, endMs });
    setStartPick(null);
    setDraftText('');
  }

  function submitDraft() {
    if (!draft || !draftText.trim()) return;
    onCreateRange(draft.startMs, draft.endMs, draftText.trim());
    setDraft(null);
    setDraftText('');
  }

  return (
    <div className="scrubber">
      <div
        ref={trackRef}
        className={isDisabled ? 'scrubber-track disabled' : 'scrubber-track'}
        onClick={handleClick}
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

        {/* First point placed, waiting for the second click: show a narrow
            marker at the start position. */}
        {startPick !== null && (
          <div
            className="scrubber-draft"
            style={{
              left: `${(startPick / totalMs) * 100}%`,
              width: '1%',
            }}
          />
        )}

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

      {draft && (
        <div className="pin-popover scrubber-popover" onClick={(e) => e.stopPropagation()}>
          <div className="scrubber-popover-range">
            {formatMs(draft.startMs)} – {formatMs(draft.endMs)}
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

      {!isDisabled && startPick !== null && (
        <p className="canvas-hint">Clic para marcar el final del tramo</p>
      )}
      {!isDisabled && startPick === null && !draft && (
        <p className="canvas-hint">Hacé clic en el punto de inicio y luego en el punto de fin para comentar un tramo del video.</p>
      )}
    </div>
  );
}

