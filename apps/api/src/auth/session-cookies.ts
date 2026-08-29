import type { Response } from 'express';
import type { Env } from '../config/env.schema';
import { cookiePolicy } from './cookies';

export interface IssuedSession {
  rawToken: string;
  csrfToken: string;
}

/**
 * Shared cookie-pair setter for both session issuers (staff login and magic
 * link redemption). Names/flags come exclusively from the shared policy so
 * the `__Host-` prefix always travels with Secure.
 */
export function setSessionCookies(
  res: Response,
  config: Pick<Env, 'NODE_ENV' | 'SESSION_TTL_DAYS' | 'COOKIE_SECURE'>,
  issued: IssuedSession,
): void {
  const policy = cookiePolicy(config);
  const maxAge = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(policy.sessionName, issued.rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: policy.secure,
    path: '/',
    maxAge,
  });
  // Double-submit pair: readable by same-origin JS, signed with the
  // session-bound secret. NOT HttpOnly by design.
  res.cookie(policy.csrfName, issued.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: policy.secure,
    path: '/',
    maxAge,
  });
  // Expire the alternate-mode CSRF cookie so a token minted under the other
  // policy (e.g. `__Host-csrf` from a previous production-mode login) can
  // never linger alongside the newly issued one.
  expireCookie(res, policy.legacyCsrfName, false);
}

/**
 * Expire a cookie by name. ALWAYS sends the Secure attribute: a cookie stored
 * with Secure (e.g. `__Host-csrf` minted under production mode) can only be
 * overwritten/deleted by a Set-Cookie that also carries Secure — a plain-http
 * wipe is silently ignored, leaving the stale token alive (that was the 403
 * source). Browsers accept Secure Set-Cookie on http://localhost.
 */
function expireCookie(res: Response, name: string, httpOnly: boolean): void {
  res.cookie(name, '', {
    httpOnly,
    sameSite: 'lax',
    secure: true,
    path: '/',
    expires: new Date(0),
  });
}

/**
 * Self-healing expiry of the alternate-mode CSRF cookie. Called on every
 * authenticated request (SessionGuard) as well as login/logout, so a stale
 * `__Host-csrf` left over from a previous cookie mode is removed on the next
 * API call — no manual cookie clearing or re-login required.
 */
export function expireLegacyCsrfCookie(res: Response, config: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>): void {
  expireCookie(res, cookiePolicy(config).legacyCsrfName, false);
}

export function clearSessionCookies(res: Response, config: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>): void {
  const policy = cookiePolicy(config);
  expireCookie(res, policy.sessionName, true);
  expireCookie(res, policy.csrfName, false);
  expireCookie(res, policy.legacyCsrfName, false);
}
