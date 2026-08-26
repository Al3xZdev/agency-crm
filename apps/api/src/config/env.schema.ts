import { z } from 'zod';

/**
 * Server-side environment contract (task 2.1). Parsed once at boot; any
 * missing/invalid variable aborts startup before anything else runs.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Absolute web origin used when minting client magic-link URLs. */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3001'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().min(1).default('/app/assets'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  HEARTBEAT_PATH: z.string().default('/tmp/worker-heartbeat'),
  REMINDERS_DISABLED: z.coerce.boolean().default(false),
  DIGEST_DISABLED: z.coerce.boolean().default(false),
  /** SMTP connection URL (e.g. smtps://user:pass@smtp.example.com:465). When set, emails are sent via real SMTP; otherwise the console stub is used. */
  SMTP_URL: z.string().optional(),
  /** From address for outgoing emails (e.g. "Agency CRM <noreply@example.com>"). Required when SMTP_URL is set. */
  MAIL_FROM: z.string().optional(),
  /** Secret key for encrypting email content at rest (future S11b). */
  MAIL_SEAL_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
