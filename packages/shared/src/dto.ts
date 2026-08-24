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
