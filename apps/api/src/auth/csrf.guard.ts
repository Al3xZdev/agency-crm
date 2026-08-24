import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PUBLIC_KEY } from './public.decorator';
import { CSRF_COOKIE } from './cookies';

const CSRF_HEADER = 'x-csrf-token';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Double-submit CSRF gate bound to the session secret (task 2.6).
 *
 * The login response sets `__Host-csrf` (readable cookie, NOT HttpOnly)
 * containing `<nonce>.<hmac_sha256(session.csrfSecret, nonce)>`; every unsafe
 * method must echo it in `X-CSRF-Token`. A cross-site attacker can neither
 * read the cookie nor re-sign a forged nonce without the per-session secret.
 * Missing/mismatched/badly-signed pairs get an identical generic 403 before
 * any handler code runs.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    if (['GET', 'HEAD', 'OPTIONS'].includes(context.switchToHttp().getRequest<Request>().method)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    // SessionGuard ran first for any non-public route; no stash ⇒ no session ⇒ fail.
    const csrfSecret = (req as Request & { __requestContext?: { csrfSecret?: string } })
      .__requestContext?.csrfSecret;
    const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER] as string | undefined;

    if (!csrfSecret || !cookie || !header || !this.isValidPair(cookie, header, csrfSecret)) {
      throw new ForbiddenException();
    }
    return true;
  }

  private isValidPair(cookieValue: string, headerValue: string, secret: string): boolean {
    if (!safeEqual(cookieValue, headerValue)) return false;
    const dot = cookieValue.indexOf('.');
    if (dot === -1) return false;
    const nonce = cookieValue.slice(0, dot);
    const sig = cookieValue.slice(dot + 1);
    if (!nonce || !sig) return false;
    const expected = createHmac('sha256', secret).update(nonce).digest('base64url');
    return safeEqual(sig, expected);
  }
}
