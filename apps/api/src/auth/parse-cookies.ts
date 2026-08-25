import type { Request } from 'express';

/**
 * Minimal RFC 6265-style cookie-header parser shared by the auth guards.
 * Values are URI-decoded; malformed pairs are skipped silently.
 */
export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
