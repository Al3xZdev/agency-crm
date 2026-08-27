import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SEALED_PREFIX = 'v1:';

/**
 * Encryption at-rest service (task S11b). Encrypts PII fields (email body
 * content) using AES-256-GCM before writing to the database.
 *
 * Format: v1:<base64(iv)>.<base64(authTag)>.<base64(ciphertext)>
 *
 * When MAIL_SEAL_KEY is not set, operates in pass-through mode (no encryption).
 * Strings without the v1: prefix are treated as plaintext (backward compat).
 */
@Injectable()
export class SealService {
  private readonly logger = new Logger(SealService.name);
  private readonly key: Buffer | null;

  constructor() {
    const raw = process.env.MAIL_SEAL_KEY;
    if (raw) {
      this.key = Buffer.from(raw, 'base64');
      if (this.key.length !== 32) {
        throw new Error('MAIL_SEAL_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)');
      }
      this.logger.log('SealService active: email body encryption enabled');
    } else {
      this.key = null;
      this.logger.log('SealService pass-through: no MAIL_SEAL_KEY configured');
    }
  }

  seal(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${SEALED_PREFIX}${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  unseal(sealed: string): string {
    if (!this.key) return sealed;
    if (!sealed.startsWith(SEALED_PREFIX)) return sealed;

    const rest = sealed.slice(SEALED_PREFIX.length);
    const dot1 = rest.indexOf('.');
    const dot2 = rest.indexOf('.', dot1 + 1);
    if (dot1 === -1 || dot2 === -1) {
      this.logger.warn('Malformed sealed string: missing delimiters, returning as-is');
      return sealed;
    }

    const iv = Buffer.from(rest.slice(0, dot1), 'base64');
    const authTag = Buffer.from(rest.slice(dot1 + 1, dot2), 'base64');
    const ciphertext = Buffer.from(rest.slice(dot2 + 1), 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
