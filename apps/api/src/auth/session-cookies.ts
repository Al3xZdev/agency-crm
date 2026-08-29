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
  expireCookie(res, policy.legacyCsrfName, false, policy.secure);
}

function expireCookie(res: Response, name: string, httpOnly: boolean, secure: boolean): void {
  res.cookie(name, '', {
    httpOnly,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(0),
  });
}

export function clearSessionCookies(res: Response, config: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>): void {
  const policy = cookiePolicy(config);
  expireCookie(res, policy.sessionName, true, policy.secure);
  expireCookie(res, policy.csrfName, false, policy.secure);
  expireCookie(res, policy.legacyCsrfName, false, policy.secure);
}
