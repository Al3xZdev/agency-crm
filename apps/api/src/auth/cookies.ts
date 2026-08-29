import type { Env } from '../config/env.schema';

/**
 * Single source of truth for auth-cookie naming and security flags.
 *
 * The `__Host-` prefix REQUIRES the Secure attribute — browsers silently
 * reject such cookies otherwise. It is therefore used ONLY when Secure is
 * on (production). Plain-http environments (dev/test/LAN self-hosting
 * without TLS termination) get an unprefixed name so flows actually work;
 * production deployments must terminate TLS in front of `api`.
 */
export interface CookiePolicy {
  readonly secure: boolean;
  readonly sessionName: string;
  readonly csrfName: string;
  /** The alternate CSRF cookie name (the one the OTHER cookie mode uses).
   *  Issuers must expire it alongside the current one so a policy switch
   *  (Secure→plain-http or vice versa) cannot leave a stale token that the
   *  client keeps echoing: a stale `__Host-csrf` next to `agency_csrf` makes
   *  apiFetch send the wrong header and every mutation 403s. */
  readonly legacyCsrfName: string;
}

export const SESSION_COOKIE = 'agency_session';
export const CSRF_SECURE_NAME = '__Host-csrf';
export const CSRF_PLAIN_NAME = 'agency_csrf';

export function cookiePolicy(config: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>): CookiePolicy {
  const secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
  return {
    secure,
    sessionName: SESSION_COOKIE,
    csrfName: secure ? CSRF_SECURE_NAME : CSRF_PLAIN_NAME,
    legacyCsrfName: secure ? CSRF_PLAIN_NAME : CSRF_SECURE_NAME,
  };
}
