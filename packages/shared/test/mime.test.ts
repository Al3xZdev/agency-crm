import { describe, expect, it } from 'vitest';
import { ALLOWED_MIME, isAllowedMime } from '../src/mime';

describe('ALLOWED_MIME allowlist (spec Cap 5)', () => {
  it('contains exactly the seven contracted types', () => {
    expect([...ALLOWED_MIME]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'text/plain',
      'text/markdown',
    ]);
  });

  it('admits every listed type', () => {
    for (const mime of ALLOWED_MIME) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });

  it('rejects disallowed and lookalike types', () => {
    expect(isAllowedMime('video/x-msvideo')).toBe(false); // spec Scn "Disallowed type" (.avi)
    expect(isAllowedMime('application/pdf')).toBe(false);
    expect(isAllowedMime('image/gif')).toBe(false);
    expect(isAllowedMime('IMAGE/PNG')).toBe(false); // exact match; normalization is upstream's job
    expect(isAllowedMime('')).toBe(false);
  });
});
