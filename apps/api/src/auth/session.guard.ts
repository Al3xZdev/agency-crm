import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PUBLIC_KEY } from './public.decorator';
import { parseCookies } from './parse-cookies';
import { SESSION_COOKIE } from './cookies';
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
  ) {}

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
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.kind !== 'STAFF' ||
      !session.user?.isActive
    ) {
      throw new UnauthorizedException();
    }

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
    return true;
  }
}
