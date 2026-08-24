import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '../src/env';

const baseEnv = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/agency',
  WEB_PUBLIC_URL: 'https://hub.example.com',
};

describe('serverEnvSchema', () => {
  it('applies design §10 defaults to a minimal env', () => {
    const env = parseServerEnv(baseEnv);
    expect(env).toMatchObject({
      SESSION_TTL_DAYS: 7,
      AGENCY_TIMEZONE: 'UTC',
      REMINDERS_DISABLED: false,
      DIGEST_DISABLED: false,
      WORKER_CONCURRENCY: 2,
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_PATH: '/data/assets',
      MAX_UPLOAD_BYTES: 524288000,
    });
  });

  it('coerces numeric and boolean env strings', () => {
    const env = parseServerEnv({
      ...baseEnv,
      SESSION_TTL_DAYS: '14',
      REMINDERS_DISABLED: 'true',
      MAX_UPLOAD_BYTES: '1048576',
    });
    expect(env.SESSION_TTL_DAYS).toBe(14);
    expect(env.REMINDERS_DISABLED).toBe(true);
    expect(env.MAX_UPLOAD_BYTES).toBe(1048576);
  });

  it('rejects an invalid DATABASE_URL naming every offending key', () => {
    try {
      parseServerEnv({ ...baseEnv, DATABASE_URL: 'not-a-url', SESSION_TTL_DAYS: '-3' });
      throw new Error('expected parseServerEnv to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('SESSION_TTL_DAYS');
      expect(message).not.toBe('expected parseServerEnv to throw');
    }
  });
});
