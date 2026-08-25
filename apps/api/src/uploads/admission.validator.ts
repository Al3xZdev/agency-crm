import { isAllowedMime } from '@agency-crm/shared';

/** 500 MiB cap — spec Cap 5. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export type AdmissionFailure =
  | { code: 'PAYLOAD_TOO_LARGE'; httpStatus: 413 }
  | { code: 'UNSUPPORTED_MEDIA_TYPE'; httpStatus: 415 }
  | { code: 'UNSAFE_FILENAME'; httpStatus: 400 };

export interface AdmissionInput {
  /** Raw Content-Length header value, if the client sent one. */
  contentLengthHeader?: string | string[];
  declaredMime?: string;
  filename?: string;
}

const EXTENSION_BY_MIME: Record<string, string | readonly string[]> = {
  'image/png': '.png',
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': ['.mov', '.qt'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
};

/**
 * Ordered admission gate (task 5b.3). The sequence is CONTRACTUAL and runs
 * BEFORE any body parsing (Busboy never starts on rejection):
 *   1. authn/authZ on the target creative — handled by guards + service
 *      lookup upstream of this validator;
 *   2. declared size present AND ≤ cap ⇒ else 413;
 *   3. declared MIME + file extension jointly in the allowlist ⇒ else 415;
 *   4. filename sanitization.
 * Declared values are untrusted hints; the worker re-sniffs real content
 * (slice 6) and LocalDriver verifies actual byte counts.
 */
export function validateAdmission(input: AdmissionInput): AdmissionFailure | null {
  // (2) declared size — a missing or oversized declaration rejects without
  // reading a single body byte.
  const raw = Array.isArray(input.contentLengthHeader)
    ? input.contentLengthHeader[0]
    : input.contentLengthHeader;
  const declared = raw !== undefined ? Number(raw) : NaN;
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_UPLOAD_BYTES) {
    return { code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 };
  }

  // (3) declared MIME must be allowlisted AND agree with the extension.
  const mime = (input.declaredMime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = filenameExtension(input.filename);
  const allowedExtensions: string | readonly string[] | undefined = EXTENSION_BY_MIME[mime];
  if (!isAllowedMime(mime) || allowedExtensions === undefined) {
    return { code: 'UNSUPPORTED_MEDIA_TYPE', httpStatus: 415 };
  }
  const exts = Array.isArray(allowedExtensions) ? [...allowedExtensions] : [allowedExtensions];
  if (!exts.includes(ext)) {
    return { code: 'UNSUPPORTED_MEDIA_TYPE', httpStatus: 415 };
  }

  // (4) filename hygiene — storage uses content addresses, so the name only
  // feeds audit/display; still reject path tricks and control characters.
  if (input.filename && /[/\\\u0000-\u001f]/.test(input.filename)) {
    return { code: 'UNSAFE_FILENAME', httpStatus: 400 };
  }

  return null;
}

function filenameExtension(filename?: string): string {
  if (!filename) return '';
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}
