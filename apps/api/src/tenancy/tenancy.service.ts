import { Inject, Injectable } from '@nestjs/common';
import { SYSTEM_PRISMA } from '../prisma/system-prisma.token';
import type { PrismaService } from '../prisma/prisma.service';
import { currentPrincipal, type Principal } from './request-context.als';
import { tenancyQueryExtension } from './tenancy.extension';

function buildScoped(prisma: PrismaService, principal: Principal) {
  return prisma.$extends(tenancyQueryExtension(principal));
}

/** Extended client whose every operation is tenant-filtered. */
export type ScopedPrisma = ReturnType<typeof buildScoped>;

/**
 * Entry point for all tenant-scoped persistence (tasks 3.3). Services call
 * `tenancy.scoped()` inside a guarded request; the extended client is cached
 * per principal object identity (one per request via the ALS store).
 *
 * System-level work bypasses this entirely through SYSTEM_PRISMA, which the
 * ESLint import whitelist restricts to system modules.
 */
@Injectable()
export class TenancyService {
  private readonly prisma: PrismaService;
  private readonly cache = new WeakMap<Principal, ScopedPrisma>();

  constructor(@Inject(SYSTEM_PRISMA) prisma: PrismaService) {
    this.prisma = prisma;
  }

  scoped(): ScopedPrisma {
    const principal = currentPrincipal();
    if (!principal) {
      throw new Error('TENANCY_VIOLATION: scoped() called outside an authenticated request context');
    }
    let client = this.cache.get(principal);
    if (!client) {
      client = buildScoped(this.prisma, principal);
      this.cache.set(principal, client);
    }
    return client;
  }
}
