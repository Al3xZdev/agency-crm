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

export const createCommentSchema = z
  .object({
    anchor: z.enum(['PLAIN', 'PIN', 'RANGE']),
    posX: z.number().min(0).max(10000).optional(),
    posY: z.number().min(0).max(10000).optional(),
    startMs: z.number().min(0).optional(),
    endMs: z.number().min(0).optional(),
    body: z.string().min(1).max(5000),
  })
  .refine(
    (data) => {
      if (data.anchor === 'PIN') return data.posX !== undefined && data.posY !== undefined;
      if (data.anchor === 'RANGE') return data.startMs !== undefined && data.endMs !== undefined;
      return true;
    },
    { message: 'PIN requires posX and posY; RANGE requires startMs and endMs' },
  );
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

export const castDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'REQUEST_CHANGES']),
});
export type CastDecisionDto = z.infer<typeof castDecisionSchema>;
