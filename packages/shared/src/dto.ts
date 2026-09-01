import { z } from 'zod';

/**
 * API DTO stubs (task 1.2). Slices 2/5a extend these as endpoints land;
 * routes consume the SAME schemas for request validation (one contract).
 */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  contact: z.string().max(500).optional(),
});
export type CreateClientDto = z.infer<typeof createClientSchema>;

export const createCampaignSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(200),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

/** `kind` is fixed at creation (spec Cap 4); updates must reject changes to it. */
export const createCreativeSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().min(1).max(300),
  kind: z.enum(['IMAGE', 'VIDEO', 'TEXT']),
});
export type CreateCreativeDto = z.infer<typeof createCreativeSchema>;

// ---- drawing strokes (DRAW comment anchors) ----

/** A stroke point normalized to basis points 0..10000 — (0,0) is the top-left
 * corner of the video frame, (10000,10000) the bottom-right. */
export const strokePointSchema = z.object({
  x: z.number().int().min(0).max(10000),
  y: z.number().int().min(0).max(10000),
});
export type StrokePoint = z.infer<typeof strokePointSchema>;

/** A single freehand stroke: a polyline of at least 2 frame-relative points.
 * `color`/`width` are optional on input and default on parse, so persisted
 * strokes always carry an explicit color and width. */
export const strokeSchema = z.object({
  points: z.array(strokePointSchema).min(2),
  color: z.string().min(1).max(100).default('#EF4444'),
  width: z.number().min(1).max(64).default(4),
});
/** Client-side stroke shape — `color`/`width` may be omitted (defaults apply
 * when the API validates). */
export type StrokeInput = z.input<typeof strokeSchema>;

export const createCommentSchema = z
  .object({
    anchor: z.enum(['PLAIN', 'PIN', 'RANGE', 'DRAW']),
    posX: z.number().min(0).max(10000).optional(),
    posY: z.number().min(0).max(10000).optional(),
    startMs: z.number().min(0).optional(),
    endMs: z.number().min(0).optional(),
    strokes: z.array(strokeSchema).optional(),
    body: z.string().min(1).max(5000),
  })
  .refine(
    (data) => {
      if (data.anchor === 'PIN') return data.posX !== undefined && data.posY !== undefined;
      if (data.anchor === 'RANGE') return data.startMs !== undefined;
      if (data.anchor === 'DRAW') {
        return (
          data.startMs !== undefined &&
          data.endMs === undefined &&
          (data.strokes?.length ?? 0) >= 1
        );
      }
      // PLAIN (and any non-DRAW anchor): strokes must be absent or empty.
      return data.strokes === undefined || data.strokes.length === 0;
    },
    {
      message:
        'PIN requires posX and posY; RANGE requires startMs (endMs optional); DRAW requires startMs and at least one stroke and disallows endMs; non-DRAW anchors cannot carry strokes',
    },
  );
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

export const castDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'REQUEST_CHANGES']),
});
export type CastDecisionDto = z.infer<typeof castDecisionSchema>;
