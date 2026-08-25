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
  config: Pick<Env, 'NODE_ENV' | 'SESSION_TTL_DAYS'>,
  issued: IssuedSession,
): void {
  const policy = cookiePolicy(config.NODE_ENV);
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
}

export function clearSessionCookies(res: Response, config: Pick<Env, 'NODE_ENV'>): void {
  const policy = cookiePolicy(config.NODE_ENV);
  const opts = { path: '/', secure: policy.secure, sameSite: 'lax' as const };
  res.clearCookie(policy.sessionName, { ...opts, httpOnly: true });
  res.clearCookie(policy.csrfName, { ...opts, httpOnly: false });
}
