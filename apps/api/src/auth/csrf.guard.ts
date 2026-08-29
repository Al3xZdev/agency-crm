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
import { parseCookies } from './parse-cookies';
import { cookiePolicy } from './cookies';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';

const CSRF_HEADER = 'x-csrf-token';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Double-submit CSRF gate bound to the session secret (task 2.6).
 *
 * The login response sets a readable (NOT HttpOnly) CSRF cookie containing
 * `<nonce>.<hmac_sha256(session.csrfSecret, nonce)>`; every unsafe method
 * must echo it in `X-CSRF-Token`. A cross-site attacker can neither read the
 * cookie nor re-sign a forged nonce without the per-session secret.
 * Missing/mismatched/badly-signed pairs get an identical generic 403 before
 * any handler code runs. Cookie naming follows the shared cookie policy so
 * the `__Host-` prefix is only used when Secure is on.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly csrfCookieName: string;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) config: Env,
  ) {
    this.csrfCookieName = cookiePolicy(config).csrfName;
  }

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
    const cookie = parseCookies(req)[this.csrfCookieName];
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
