import { randomBytes } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SealService } from '../../src/crypto/seal.service';

// Generate a valid 32-byte key encoded as base64
function makeKey(): string {
  return randomBytes(32).toString('base64');
}

describe('SealService', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MAIL_SEAL_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAIL_SEAL_KEY;
    } else {
      process.env.MAIL_SEAL_KEY = originalEnv;
    }
  });

  describe('when MAIL_SEAL_KEY is NOT set (pass-through)', () => {
    it('seal returns plaintext as-is', () => {
      delete process.env.MAIL_SEAL_KEY;
      const svc = new SealService();
      expect(svc.seal('hello world')).toBe('hello world');
    });

    it('unseal returns input as-is', () => {
      delete process.env.MAIL_SEAL_KEY;
      const svc = new SealService();
      expect(svc.unseal('anything')).toBe('anything');
    });

    it('handles empty string', () => {
      delete process.env.MAIL_SEAL_KEY;
      const svc = new SealService();
      expect(svc.seal('')).toBe('');
      expect(svc.unseal('')).toBe('');
    });

    it('roundtrips through seal/unseal returning original', () => {
      delete process.env.MAIL_SEAL_KEY;
      const svc = new SealService();
      const input = 'test content 123';
      expect(svc.unseal(svc.seal(input))).toBe(input);
    });
  });

  describe('when MAIL_SEAL_KEY is set', () => {
    it('seal/unseal roundtrip preserves original', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const plaintext = 'Hello, this is secret PII content!';
      const sealed = svc.seal(plaintext);

      expect(sealed).not.toBe(plaintext);
      expect(svc.unseal(sealed)).toBe(plaintext);
    });

    it('sealed string starts with v1: prefix', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const sealed = svc.seal('test');
      expect(sealed).toMatch(/^v1:/);
    });

    it('sealed format has exactly three dot-separated parts after v1:', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const sealed = svc.seal('test data');
      const rest = sealed.slice(3); // after "v1:"
      const parts = rest.split('.');
      expect(parts).toHaveLength(3);
    });

    it('different calls produce different ciphertext (random IV)', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const a = svc.seal('same input');
      const b = svc.seal('same input');
      expect(a).not.toBe(b);
      // But both decrypt to the same plaintext
      expect(svc.unseal(a)).toBe('same input');
      expect(svc.unseal(b)).toBe('same input');
    });

    it('handles empty string', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const sealed = svc.seal('');
      expect(sealed).toMatch(/^v1:/);
      expect(svc.unseal(sealed)).toBe('');
    });

    it('handles long multiline HTML content', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const html = '<p>Hello</p>\n<p>Line 2</p>\n'.repeat(50);
      expect(svc.unseal(svc.seal(html))).toBe(html);
    });

    it('unseal of non-v1 string returns as-is (backward compat)', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      expect(svc.unseal('plaintext email body')).toBe('plaintext email body');
      expect(svc.unseal('v2:something')).toBe('v2:something');
    });
  });

  describe('v1: prefix detection', () => {
    it('recognizes v1: prefix when key is set', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      const sealed = svc.seal('data');
      expect(sealed.startsWith('v1:')).toBe(true);
      expect(svc.unseal(sealed)).toBe('data');
    });

    it('backward compat: unseal with key set treats non-v1 as plaintext', () => {
      process.env.MAIL_SEAL_KEY = makeKey();
      const svc = new SealService();
      // A string that looks encrypted but lacks v1: prefix
      const legacy = 'base64data.moredata.finaldata';
      expect(svc.unseal(legacy)).toBe(legacy);
    });
  });
});
