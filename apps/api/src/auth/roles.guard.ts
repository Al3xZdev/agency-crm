import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import type { StashRequest } from './session.guard';
import type { RequestContext } from '../tenancy/request-context.als';

/**
 * Route-level role gate (task 2.7). Full role matrix lands with S3; this
 * slice already enforces the staff-side half of "Staff endpoint denied to
 * client": a route marked `@Roles(...)` rejects any principal whose role is
 * not listed, before the handler (and its tenancy scope) ever runs.
 */
@Injectable()
export class RolesGuard implements CanActivate {
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

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<StashRequest>();
    const ctx = req.__requestContext as RequestContext | undefined;
    if (!ctx?.principal.role || !required.includes(ctx.principal.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
