import { z } from 'zod';

/** Env strings: only the literal "true"/"false" are accepted (no truthy surprises). */
const booleanish = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Server environment contract (design §10). S1 ships the schema + defaults;
 * task 2.1 wires it into a fail-fast ConfigModule at boot.
 */
export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  AGENCY_TIMEZONE: z.string().min(1).default('UTC'),
  REMINDERS_DISABLED: booleanish,
  DIGEST_DISABLED: booleanish,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().min(1).default('/data/assets'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(524288000),
  WEB_PUBLIC_URL: z.string().url(),
  // S3 profile (slice 12)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.optional(),
  // Mailer (slices 11a/11b)
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_SEAL_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parse-and-throw helper; surfaces ALL invalid keys at once for fail-fast boot. */
export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}
