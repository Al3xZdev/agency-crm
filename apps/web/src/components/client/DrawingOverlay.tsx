'use client';

import { PointerEvent as ReactPointerEvent, RefObject, useEffect, useRef, useState } from 'react';

import type { StrokeInput } from '@agency-crm/shared';

const DEFAULT_COLOR = '#EF4444';
const DEFAULT_WIDTH = 4;

interface DrawingOverlayProps {
  /** Write mode: when true the overlay captures pointer strokes on a canvas. */
  active: boolean;
  /** The positioned container (video stage) the overlay sizes itself to. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Write mode: called with the drawn strokes + note when "Save comment" is
   * clicked. Strokes are normalized to basis points 0..10000. */
  onCommit?: (strokes: StrokeInput[], note: string) => void;
  /** Write mode: called when "Cancel" is clicked (discards the draft). */
  onCancel?: () => void;
  /** Read mode: strokes to render as an SVG overlay when provided. */
  strokes?: StrokeInput[];
  /** Read mode: only render while the video is paused (frozen frame). */
  paused?: boolean;
}

/**
 * Drawing overlay for DRAW comments on a frozen video frame.
 *
 * WRITE mode (`active`): a canvas absolutely positioned over the video stage
 * captures freehand pointer strokes. Every point is normalized to basis
 * points (`round(px / containerWidth * 10000)`) so strokes are resolution-
 * independent; the draft is committed through `onCommit`.
 *
 * READ mode (`strokes` provided): renders the stored strokes as an SVG with a
 * `0 0 10000 10000` viewBox and `preserveAspectRatio="none"`, stretched over
 * the same container, so any comment's drawing aligns with the frame it was
 * drawn on. `vector-effect: non-scaling-stroke` keeps the stroke width in
 * screen pixels instead of viewBox units.
 */
export function DrawingOverlay({
  active,
  containerRef,
  onCommit,
  onCancel,
  strokes,
  paused = true,
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<StrokeInput | null>(null);
  const draftRef = useRef<StrokeInput[]>([]);
  const [draft, setDraft] = useState<StrokeInput[]>([]);
  const [note, setNote] = useState('');
  const [sizeTick, setSizeTick] = useState(0);

  // Keep the latest draft reachable from pointer handlers without re-adding
  // listeners on every state change.
  draftRef.current = draft;

  // Size the canvas buffer to the container and repaint the committed draft.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of draftRef.current) {
      const points = stroke.points;
      const first = points[0];
      if (!first) continue;
      ctx.strokeStyle = stroke.color ?? DEFAULT_COLOR;
      ctx.lineWidth = stroke.width ?? DEFAULT_WIDTH;
      ctx.beginPath();
      ctx.moveTo(...toPx(first.x, first.y));
      for (let i = 1; i < points.length; i++) {
        const point = points[i];
        if (!point) continue;
        ctx.lineTo(...toPx(point.x, point.y));
      }
      ctx.stroke();
    }
  }, [active, containerRef, draft, sizeTick]);

  // Repaint when the container resizes (canvas buffer follows the rect).
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const observer = new ResizeObserver(() => setSizeTick((tick) => tick + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, containerRef]);

  function toPx(bpX: number, bpY: number): [number, number] {
    const container = containerRef.current;
    if (!container) return [0, 0];
    const rect = container.getBoundingClientRect();
    return [(bpX / 10000) * rect.width, (bpY / 10000) * rect.height];
  }

  function toBasisPoint(e: ReactPointerEvent): { x: number; y: number } | null {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const clamp = (value: number) => Math.min(10000, Math.max(0, value));
    return {
      x: clamp(Math.round(((e.clientX - rect.left) / rect.width) * 10000)),
      y: clamp(Math.round(((e.clientY - rect.top) / rect.height) * 10000)),
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    const point = toBasisPoint(e);
    if (!point) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    currentStrokeRef.current = { points: [point], color: DEFAULT_COLOR, width: DEFAULT_WIDTH };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active || !drawingRef.current) return;
    const point = toBasisPoint(e);
    const stroke = currentStrokeRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!point || !stroke || !canvas || !ctx) return;

    const last = stroke.points[stroke.points.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    stroke.points.push(point);

    // Incremental segment draw — no React round trip per pointermove.
    const points = stroke.points;
    const prev = points[points.length - 2];
    const current = points[points.length - 1];
    if (!prev || !current) return;
    ctx.strokeStyle = stroke.color ?? DEFAULT_COLOR;
    ctx.lineWidth = stroke.width ?? DEFAULT_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...toPx(prev.x, prev.y));
    ctx.lineTo(...toPx(current.x, current.y));
    ctx.stroke();
  }

  function handlePointerUp() {
    if (!active || !drawingRef.current) return;
    drawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (!stroke) return;
    // A tap (single point) is discarded — a stroke needs at least 2 points.
    if (stroke.points.length >= 2) {
      setDraft([...draftRef.current, stroke]);
    }
  }

  function save() {
    if (draftRef.current.length === 0 || !note.trim()) return;
    onCommit?.(draftRef.current, note);
    setDraft([]);
    setNote('');
  }

  function cancel() {
    onCancel?.();
    setDraft([]);
    setNote('');
  }

  // READ mode: render the stored strokes over the frozen frame.
  if (strokes !== undefined) {
    if (!paused || strokes.length === 0) return null;
    return (
      <div className="drawing-overlay drawing-overlay-read">
        <svg viewBox="0 0 10000 10000" preserveAspectRatio="none" aria-hidden="true">
          {strokes.map((stroke, index) => (
            <polyline
              key={index}
              points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={stroke.color ?? DEFAULT_COLOR}
              strokeWidth={stroke.width ?? DEFAULT_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    );
  }

  // WRITE mode: capture freehand strokes on a canvas.
  if (!active) return null;
  return (
    <div className="drawing-overlay drawing-overlay-write">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div className="drawing-panel" onClick={(e) => e.stopPropagation()}>
        <textarea
          rows={2}
          placeholder="Add a note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="drawing-panel-actions">
          <button className="btn ghost" onClick={cancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={draft.length === 0 || !note.trim()}>
            Save comment
          </button>
        </div>
      </div>
    </div>
  );
}