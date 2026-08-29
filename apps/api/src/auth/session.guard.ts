import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PUBLIC_KEY } from './public.decorator';
import { parseCookies } from './parse-cookies';
import { SESSION_COOKIE } from './cookies';
import { expireLegacyCsrfCookie } from './session-cookies';
import { CONFIG } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context.als';

export interface StashRequest extends Request {
  __requestContext?: RequestContext;
}

/**
 * Global authentication gate (task 2.5): resolves the session cookie to a
 * principal, enforces TTL/revocation, and stashes the request context for
 * ContextInterceptor (ALS) plus CsrfGuard/RolesGuard (direct read).
 *
 * Revoked or expired sessions and missing cookies are indistinguishable to
 * the caller — always the same generic 401 (spec Cap 1).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Env,
  ) {}

  private heal(req: Request, context: ExecutionContext): void {
    // Self-healing: every authenticated response also expires the alternate
    // CSRF cookie (with Secure, so it can actually remove a Secure cookie).
    // A stale `__Host-csrf` left over from a previous cookie mode is wiped on
    // the next API call — no manual cookie clearing or re-login required.
    const res = context.switchToHttp().getResponse<Response>();
    expireLegacyCsrfCookie(res, this.config);
    void req;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest<StashRequest>();
    const raw = parseCookies(req)[SESSION_COOKIE];
    if (!raw) throw new UnauthorizedException();

    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true, magicLink: true },
    });
    const expired =
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now();

    if (!expired && session.kind === 'STAFF') {
      if (!session.user?.isActive) throw new UnauthorizedException();
      req.__requestContext = {
        principal: {
          kind: 'STAFF',
          agencyId: session.agencyId,
          sessionId: session.id,
          userId: session.userId ?? undefined,
          role: session.user.role,
        },
        csrfSecret: session.csrfSecret,
      };
      this.heal(req, context);
      return true;
    }

    if (!expired && session.kind === 'CLIENT') {
      if (
        !session.clientId ||
        !session.magicLinkId ||
        !session.magicLink ||
        session.magicLink.revokedAt !== null
      ) {
        throw new UnauthorizedException();
      }
      req.__requestContext = {
        principal: {
          kind: 'CLIENT',
          agencyId: session.agencyId,
          sessionId: session.id,
          clientId: session.clientId,
          magicLinkId: session.magicLinkId,
        },
        csrfSecret: session.csrfSecret,
      };
      this.heal(req, context);
      return true;
    }

    throw new UnauthorizedException();
  }
}
