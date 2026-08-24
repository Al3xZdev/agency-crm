/**
 * Spec Cap 5: exact upload MIME allowlist. Admission validation (task 5b.3)
 * rejects any declared type outside this list with 415 UNSUPPORTED_MEDIA_TYPE.
 */
export const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'text/plain',
  'text/markdown',
] as const;

export type AllowedMime = (typeof ALLOWED_MIME)[number];

/** Exact-match membership check (case-sensitive; declared MIME is normalized upstream). */
export function isAllowedMime(value: string): value is AllowedMime {
  return (ALLOWED_MIME as readonly string[]).includes(value);
}
