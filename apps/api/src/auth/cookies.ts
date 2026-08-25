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
}

export const SESSION_COOKIE = 'agency_session';

export function cookiePolicy(nodeEnv: Env['NODE_ENV']): CookiePolicy {
  const production = nodeEnv === 'production';
  return {
    secure: production,
    sessionName: SESSION_COOKIE,
    csrfName: production ? '__Host-csrf' : 'agency_csrf',
  };
}
